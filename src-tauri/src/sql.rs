//! SQL scripts against SQLite, which is compiled in: a database file or a
//! fresh in-memory one per run. A script runs statement by statement, split
//! where SQLite itself says a statement is complete (so triggers with
//! `BEGIN … END;` stay whole); each statement's rows or changes come back,
//! and the run stops at the first error.

use rusqlite::types::ValueRef;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Instant;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    name: String,
    decl_type: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    /// Where the statement is in the script, in UTF-16 units (as the editor counts).
    from: usize,
    to: usize,
    sql: String,
    columns: Vec<Column>,
    rows: Vec<Vec<Value>>,
    /// More rows than were sent.
    truncated: bool,
    /// Rows inserted, changed or deleted.
    changes: u64,
    duration_ms: u64,
    error: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlRun {
    results: Vec<StatementResult>,
    sqlite_version: String,
}

/// Whether the text holds nothing but white space and comments.
pub fn is_blank(sql: &str) -> bool {
    let b = sql.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
        } else if b[i..].starts_with(b"--") {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if b[i..].starts_with(b"/*") {
            match sql[i + 2..].find("*/") {
                Some(end) => i += end + 4,
                None => return true,
            }
        } else {
            return false;
        }
    }
    true
}

fn complete(sql: &str) -> bool {
    let Ok(c) = std::ffi::CString::new(sql) else { return false };
    // SAFETY: a valid NUL-terminated string; sqlite3_complete only reads it.
    unsafe { rusqlite::ffi::sqlite3_complete(c.as_ptr()) != 0 }
}

/// Splits a script into statements (byte ranges, without leading white space and comments kept as they are).
pub fn split(script: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, _) in script.match_indices(';') {
        if i < start {
            continue;
        }
        let piece = &script[start..=i];
        if complete(piece) {
            if !is_blank(&piece[..piece.len() - 1]) {
                out.push((start, i + 1));
            }
            start = i + 1;
        }
    }
    if !is_blank(&script[start..]) {
        out.push((start, script.len()));
    }
    // Leave out what comes before the statement itself (white space, the comment above it).
    out.into_iter()
        .map(|(a, b)| {
            let text = &script[a..b];
            let lead = text.len() - text.trim_start().len();
            (a + lead, b)
        })
        .collect()
}

fn utf16(script: &str, byte: usize) -> usize {
    script[..byte].encode_utf16().count()
}

fn value(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) if i.unsigned_abs() < (1u64 << 53) => json!(i),
        ValueRef::Integer(i) => json!(i.to_string()),
        ValueRef::Real(f) if f.is_finite() => json!(f),
        ValueRef::Real(f) => json!(f.to_string()),
        ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
        ValueRef::Blob(b) => {
            let hex: String = b.iter().take(32).map(|x| format!("{x:02X}")).collect();
            json!({ "blob": b.len(), "hex": hex })
        }
    }
}

fn open(db: &Option<String>) -> Result<Connection, String> {
    match db.as_deref().filter(|d| !d.is_empty()) {
        Some(path) => {
            if let Some(dir) = std::path::Path::new(path).parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            Connection::open(path).map_err(|e| format!("The database couldn't be opened: {e}"))
        }
        None => Connection::open_in_memory().map_err(err),
    }
}

/// A statement's columns, rows, whether there were more rows, and the rows it changed.
type Outcome = (Vec<Column>, Vec<Vec<Value>>, bool, u64);

fn run_one(conn: &Connection, sql: &str, max_rows: usize) -> Result<Outcome, String> {
    let before = conn.total_changes();
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let columns: Vec<Column> = stmt.columns().iter().map(|c| Column { name: c.name().to_string(), decl_type: c.decl_type().unwrap_or("").to_string() }).collect();
    let count = columns.len();
    let mut rows = Vec::new();
    let mut truncated = false;
    let mut cursor = stmt.raw_query();
    while let Some(row) = cursor.next().map_err(err)? {
        if count == 0 {
            continue;
        }
        if rows.len() >= max_rows {
            truncated = true;
            break;
        }
        rows.push((0..count).map(|i| row.get_ref(i).map(value).unwrap_or(Value::Null)).collect());
    }
    drop(cursor);
    let changes = if count == 0 { conn.total_changes().saturating_sub(before) } else { 0 };
    Ok((columns, rows, truncated, changes))
}

/// The statement at a position (UTF-16 units): the one it is in, else the last one before it, else the first.
pub fn statement_at(script: &str, at: usize) -> Option<(usize, usize)> {
    let parts = split(script);
    let ranges: Vec<(usize, usize)> = parts.iter().map(|&(a, b)| (utf16(script, a), utf16(script, b))).collect();
    let i = ranges.iter().position(|&(a, b)| a <= at && at <= b).or_else(|| ranges.iter().rposition(|&(a, _)| a <= at)).or(if parts.is_empty() { None } else { Some(0) })?;
    Some(parts[i])
}

pub fn run_script(db: &Option<String>, script: &str, max_rows: usize) -> Result<SqlRun, String> {
    run_parts(db, script, split(script), max_rows)
}

fn run_parts(db: &Option<String>, script: &str, parts: Vec<(usize, usize)>, max_rows: usize) -> Result<SqlRun, String> {
    let conn = open(db)?;
    let mut results = Vec::new();
    for (a, b) in parts {
        let sql = &script[a..b];
        let started = Instant::now();
        let r = run_one(&conn, sql, max_rows);
        let duration_ms = started.elapsed().as_millis() as u64;
        let (from, to) = (utf16(script, a), utf16(script, b));
        match r {
            Ok((columns, rows, truncated, changes)) => results.push(StatementResult { from, to, sql: sql.to_string(), columns, rows, truncated, changes, duration_ms, error: None }),
            Err(e) => {
                results.push(StatementResult { from, to, sql: sql.to_string(), columns: vec![], rows: vec![], truncated: false, changes: 0, duration_ms, error: Some(e) });
                break;
            }
        }
    }
    Ok(SqlRun { results, sqlite_version: rusqlite::version().to_string() })
}

/// Runs a script against a database file (None: a fresh database in memory); with `at`, only the statement there.
#[tauri::command]
pub async fn sql_run(db: Option<String>, script: String, max_rows: Option<usize>, at: Option<usize>) -> Result<SqlRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let max = max_rows.unwrap_or(10_000);
        match at {
            Some(at) => run_parts(&db, &script, statement_at(&script, at).into_iter().collect(), max),
            None => run_script(&db, &script, max),
        }
    })
    .await
    .map_err(err)?
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    name: String,
    kind: String,
    columns: Vec<Column>,
}

/// The tables and views of a database file and their columns, for completion and the schema list.
#[tauri::command]
pub async fn sql_schema(db: String) -> Result<Vec<Table>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !std::path::Path::new(&db).is_file() {
            return Ok(vec![]);
        }
        let conn = open(&Some(db))?;
        let mut stmt = conn.prepare("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(err)?;
        let names: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.flatten().collect();
        let mut out = Vec::new();
        for (name, kind) in names {
            let mut info = conn.prepare("SELECT name, type FROM pragma_table_info(?1)").map_err(err)?;
            let columns = info.query_map([&name], |r| Ok(Column { name: r.get(0)?, decl_type: r.get(1)? })).map_err(err)?.flatten().collect();
            out.push(Table { name, kind, columns });
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_like_sqlite() {
        let script = "-- people\nCREATE TABLE p(id INTEGER, name TEXT);\n\nINSERT INTO p VALUES (1, 'a;b');\nCREATE TRIGGER t AFTER INSERT ON p BEGIN\n  UPDATE p SET name = upper(name);\nEND;\n/* last */ SELECT * FROM p";
        let parts: Vec<&str> = split(script).into_iter().map(|(a, b)| &script[a..b]).collect();
        assert_eq!(parts.len(), 4, "{parts:?}");
        assert!(parts[0].starts_with("-- people"));
        assert_eq!(parts[1], "INSERT INTO p VALUES (1, 'a;b');");
        assert!(parts[2].starts_with("CREATE TRIGGER") && parts[2].ends_with("END;"));
        assert_eq!(parts[3], "/* last */ SELECT * FROM p");
        assert!(split("  -- nothing\n /* here */ ").is_empty());
        let s = "SELECT 1;\nSELECT 'ü';\n\nSELECT 3";
        let at = |pos: usize| statement_at(s, pos).map(|(a, b)| &s[a..b]);
        assert_eq!(at(3), Some("SELECT 1;"));
        assert_eq!(at(14), Some("SELECT 'ü';"));
        assert_eq!(at(22), Some("SELECT 'ü';"), "a blank line after a statement belongs to it");
        assert_eq!(at(25), Some("SELECT 3"));
    }

    #[test]
    fn runs_a_script() {
        let script = "CREATE TABLE p(id INTEGER PRIMARY KEY, name TEXT, score REAL, pic BLOB);\nINSERT INTO p(name, score, pic) VALUES ('Jürgen', 1.5, x'CAFE'), ('Ana', NULL, NULL);\nSELECT id, name, score, pic FROM p ORDER BY id;\nUPDATE p SET score = 2;\nSELECT nope FROM p;\nSELECT 1;";
        let r = run_script(&None, script, 100).unwrap();
        assert_eq!(r.results.len(), 5, "stops at the error");
        assert_eq!(r.results[1].changes, 2);
        let select = &r.results[2];
        assert_eq!(select.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["id", "name", "score", "pic"]);
        assert_eq!(select.columns[2].decl_type, "REAL");
        assert_eq!(select.rows[0], vec![json!(1), json!("Jürgen"), json!(1.5), json!({"blob": 2, "hex": "CAFE"})]);
        assert_eq!(select.rows[1][2], Value::Null);
        assert_eq!(r.results[3].changes, 2);
        assert!(r.results[4].error.as_deref().unwrap().contains("nope"));
        // Offsets count UTF-16 units, so the umlaut counts as one.
        let second = &r.results[1];
        assert_eq!(&script.encode_utf16().collect::<Vec<_>>()[second.from..second.to], second.sql.encode_utf16().collect::<Vec<_>>().as_slice());
    }

    #[test]
    fn keeps_a_file_database_and_reads_its_schema() {
        let dir = std::env::temp_dir().join(format!("logiq-sql-test-{}", std::process::id()));
        let db = dir.join("data").join("shop.db");
        let path = Some(db.to_string_lossy().to_string());
        run_script(&path, "CREATE TABLE item(id INTEGER, title TEXT); CREATE VIEW v AS SELECT title FROM item;", 10).unwrap();
        let r = run_script(&path, "SELECT count(*) AS n FROM item", 10).unwrap();
        assert_eq!(r.results[0].rows[0][0], json!(0));
        let schema = tauri::async_runtime::block_on(sql_schema(path.clone().unwrap())).unwrap();
        assert_eq!(schema.len(), 2);
        assert_eq!(schema[0].name, "item");
        assert_eq!(schema[0].columns.len(), 2);
        assert_eq!(schema[1].kind, "view");
        let big = run_script(&None, "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 50) SELECT x FROM c", 20).unwrap();
        assert!(big.results[0].truncated);
        assert_eq!(big.results[0].rows.len(), 20);
        let _ = std::fs::remove_dir_all(dir);
    }
}
