//! Find in files: plain text or a regular expression, optionally matching
//! case and whole words, over every source file of the open folder.

use crate::fs::{decode, looks_binary, walk, MAX_TEXT_BYTES};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    query: String,
    match_case: bool,
    whole_word: bool,
    regex: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    /// 1-based line number.
    line: usize,
    /// 0-based column, in UTF-16 code units, as the editor counts.
    column: usize,
    length: usize,
    /// The line, trimmed to a readable length around the match.
    preview: String,
    preview_start: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    hits: Vec<SearchHit>,
    files_searched: usize,
    truncated: bool,
}

const MAX_HITS: usize = 5000;

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

pub fn search(root: &Path, opts: &SearchOptions) -> Result<SearchResult, String> {
    if opts.query.is_empty() {
        return Ok(SearchResult { hits: vec![], files_searched: 0, truncated: false });
    }
    let mut pattern = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    if opts.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!opts.match_case)
        .multi_line(true)
        .build()
        .map_err(|e| format!("Invalid regular expression: {e}"))?;

    let mut hits = Vec::new();
    let mut files = 0;
    let mut truncated = false;
    walk(root, 50_000, &mut |p| {
        if truncated {
            return;
        }
        let Ok(meta) = std::fs::metadata(p) else { return };
        if meta.len() > MAX_TEXT_BYTES {
            return;
        }
        let Ok(bytes) = std::fs::read(p) else { return };
        if looks_binary(&bytes) {
            return;
        }
        files += 1;
        let text = decode(&bytes);
        for (i, line) in text.lines().enumerate() {
            for m in re.find_iter(line) {
                if m.start() == m.end() {
                    continue;
                }
                // Keep long lines readable: start the preview a little before the match.
                let start = line[..m.start()]
                    .char_indices()
                    .rev()
                    .nth(40)
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let preview: String = line[start..].chars().take(240).collect();
                hits.push(SearchHit {
                    path: p.to_string_lossy().to_string(),
                    line: i + 1,
                    column: utf16_len(&line[..m.start()]),
                    length: utf16_len(m.as_str()),
                    preview_start: utf16_len(&line[..start]),
                    preview: preview.trim_end().to_string(),
                });
                if hits.len() >= MAX_HITS {
                    truncated = true;
                    return;
                }
            }
        }
    });
    Ok(SearchResult { hits, files_searched: files, truncated })
}

#[tauri::command]
pub async fn search_workspace(root: String, options: SearchOptions) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || search(Path::new(&root), &options))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_words_case_and_regex() {
        let dir = std::env::temp_dir().join(format!("logiq-search-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("A.java"), "class Account {\n  int count;\n  int Counter;\n}\n").unwrap();
        let opts = |q: &str, c, w, r| SearchOptions { query: q.into(), match_case: c, whole_word: w, regex: r };

        let r = search(&dir, &opts("count", false, false, false)).unwrap();
        // "Account", "count" and "Counter".
        assert_eq!(r.hits.len(), 3);
        assert_eq!((r.hits[1].line, r.hits[1].column, r.hits[1].length), (2, 6, 5));

        let r = search(&dir, &opts("count", false, true, false)).unwrap();
        assert_eq!(r.hits.len(), 1);

        let r = search(&dir, &opts("Count", true, false, false)).unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].line, 3);

        let r = search(&dir, &opts(r"int \w+;", false, false, true)).unwrap();
        assert_eq!(r.hits.len(), 2);

        assert!(search(&dir, &opts("(", false, false, true)).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
