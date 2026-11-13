import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Logiq Studio's object bench. It runs in a JVM with the project's compiled
 * classes on the class path and answers one request per line: create an
 * object, call a method, remove or keep an object. Every answer is one JSON
 * line starting with \u0001LOGIQ, and carries all objects on the bench with
 * their fields, so the window always shows the current state.
 *
 * Requests are fields separated by \u001F, with \\ and \n escaped:
 *   new    name class paramTypes arg...
 *   call   target class method paramTypes arg...   (target empty: static)
 *   remove name
 *   keep   name                                     (the last returned object)
 *   reset
 */
public class LogiqBench {

    private static final PrintStream OUT = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
    private static final Map<String, Object> objects = new LinkedHashMap<>();
    private static Object last;

    public static void main(String[] args) throws IOException {
        // Requests come on the real standard input; the program's own reads (Scanner) get an empty one.
        BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(FileDescriptor.in), StandardCharsets.UTF_8));
        System.setIn(new ByteArrayInputStream(new byte[0]));
        reply(new StringBuilder("{\"ok\":true,\"ready\":true,").append(state()).append('}'));
        for (String line; (line = in.readLine()) != null; ) {
            String[] f = split(line);
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            PrintStream capture = new PrintStream(buffer, true, StandardCharsets.UTF_8);
            PrintStream oldOut = System.out, oldErr = System.err;
            System.setOut(capture);
            System.setErr(capture);
            StringBuilder r = new StringBuilder("{");
            try {
                String value = handle(f);
                r.append("\"ok\":true");
                if (value != null) r.append(",\"value\":").append(value);
            } catch (Throwable e) {
                r.append("\"ok\":false,\"error\":").append(json(describe(e)));
            } finally {
                System.setOut(oldOut);
                System.setErr(oldErr);
            }
            r.append(",\"out\":").append(json(buffer.toString(StandardCharsets.UTF_8)));
            r.append(',').append(state()).append('}');
            reply(r);
        }
    }

    private static void reply(StringBuilder s) {
        OUT.print("\u0001LOGIQ ");
        OUT.println(s);
        OUT.flush();
    }

    private static String[] split(String line) {
        String[] parts = line.split("\u001F", -1);
        for (int i = 0; i < parts.length; i++) {
            StringBuilder b = new StringBuilder();
            String p = parts[i];
            for (int j = 0; j < p.length(); j++) {
                char c = p.charAt(j);
                if (c == '\\' && j + 1 < p.length()) {
                    char n = p.charAt(++j);
                    b.append(n == 'n' ? '\n' : n);
                } else b.append(c);
            }
            parts[i] = b.toString();
        }
        return parts;
    }

    private static String handle(String[] f) throws Throwable {
        switch (f[0]) {
            case "new": {
                String name = f[1];
                Class<?> cls = Class.forName(f[2]);
                Constructor<?> ctor = findConstructor(cls, f[3]);
                ctor.setAccessible(true);
                Object o = invoke(() -> ctor.newInstance(convert(ctor.getParameterTypes(), f, 4)));
                objects.put(name, o);
                return null;
            }
            case "call": {
                Object target = f[1].isEmpty() ? null : objects.get(f[1]);
                if (!f[1].isEmpty() && target == null) throw new IllegalArgumentException("There is no object called " + f[1] + ".");
                Class<?> cls = target != null ? target.getClass() : Class.forName(f[2]);
                Method m = findMethod(cls, f[3], f[4]);
                m.setAccessible(true);
                Object result = invoke(() -> m.invoke(target, convert(m.getParameterTypes(), f, 5)));
                if (m.getReturnType() == void.class) return null;
                last = result;
                return value(result, m.getReturnType(), true);
            }
            case "remove":
                objects.remove(f[1]);
                return null;
            case "keep":
                if (last == null) throw new IllegalArgumentException("There is no object to keep.");
                objects.put(f[1], last);
                return null;
            case "reset":
                objects.clear();
                last = null;
                return null;
            default:
                throw new IllegalArgumentException("Unknown request " + f[0]);
        }
    }

    interface Call {
        Object run() throws Throwable;
    }

    /** Runs reflective code and reports the program's own exception, not the reflection wrapper. */
    private static Object invoke(Call c) throws Throwable {
        try {
            return c.run();
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    private static String simple(Class<?> c) {
        return c.isArray() ? simple(c.getComponentType()) + "[]" : c.getSimpleName();
    }

    private static boolean matches(Class<?>[] types, String wanted) {
        String[] w = wanted.isEmpty() ? new String[0] : wanted.split(",");
        if (w.length != types.length) return false;
        for (int i = 0; i < w.length; i++) if (!simple(types[i]).equals(w[i])) return false;
        return true;
    }

    private static Constructor<?> findConstructor(Class<?> cls, String params) throws NoSuchMethodException {
        if (Modifier.isAbstract(cls.getModifiers())) throw new IllegalArgumentException(cls.getSimpleName() + " is abstract: create an object of a subclass instead.");
        for (Constructor<?> c : cls.getDeclaredConstructors()) if (matches(c.getParameterTypes(), params)) return c;
        throw new NoSuchMethodException("No constructor " + cls.getSimpleName() + "(" + params + ")");
    }

    private static Method findMethod(Class<?> cls, String name, String params) throws NoSuchMethodException {
        for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) if (m.getName().equals(name) && matches(m.getParameterTypes(), params)) return m;
            for (Class<?> i : c.getInterfaces()) {
                for (Method m : i.getMethods()) if (m.getName().equals(name) && matches(m.getParameterTypes(), params)) return m;
            }
        }
        for (Method m : cls.getMethods()) if (m.getName().equals(name) && matches(m.getParameterTypes(), params)) return m;
        throw new NoSuchMethodException("No method " + name + "(" + params + ")");
    }

    private static Object[] convert(Class<?>[] types, String[] f, int from) {
        Object[] out = new Object[types.length];
        for (int i = 0; i < types.length; i++) out[i] = convert(types[i], from + i < f.length ? f[from + i] : "");
        return out;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object convert(Class<?> t, String raw) {
        String s = raw.trim();
        try {
            if (t == String.class) {
                if (s.equals("null")) return null;
                if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) s = s.substring(1, s.length() - 1);
                else s = raw;
                return s.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"");
            }
            if (t == int.class || t == Integer.class) return Integer.parseInt(s);
            if (t == long.class || t == Long.class) return Long.parseLong(s.replaceAll("[lL]$", ""));
            if (t == short.class || t == Short.class) return Short.parseShort(s);
            if (t == byte.class || t == Byte.class) return Byte.parseByte(s);
            if (t == double.class || t == Double.class) return Double.parseDouble(s.replace(',', '.'));
            if (t == float.class || t == Float.class) return Float.parseFloat(s.replace(',', '.').replaceAll("[fF]$", ""));
            if (t == boolean.class || t == Boolean.class) {
                if (s.equalsIgnoreCase("true")) return true;
                if (s.equalsIgnoreCase("false")) return false;
                throw new IllegalArgumentException("Use true or false for a boolean, not “" + s + "”.");
            }
            if (t == char.class || t == Character.class) {
                if (s.length() >= 3 && s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length() - 1);
                if (s.length() != 1) throw new IllegalArgumentException("A char is one character, like a or 'a'.");
                return s.charAt(0);
            }
            if (s.equals("null") || s.isEmpty()) {
                if (t.isPrimitive()) throw new IllegalArgumentException("A " + t.getSimpleName() + " needs a value.");
                return null;
            }
            if (t.isEnum()) return Enum.valueOf((Class) t, s.replaceAll("^.*\\.", ""));
            if (objects.containsKey(s)) {
                Object o = objects.get(s);
                if (!t.isInstance(o)) throw new IllegalArgumentException(s + " is a " + o.getClass().getSimpleName() + ", not a " + t.getSimpleName() + ".");
                return o;
            }
            if (t.isArray()) {
                String body = s.replaceAll("^[{\\[]|[}\\]]$", "").trim();
                String[] items = body.isEmpty() ? new String[0] : body.split("\\s*,\\s*");
                Object array = Array.newInstance(t.getComponentType(), items.length);
                for (int i = 0; i < items.length; i++) Array.set(array, i, convert(t.getComponentType(), items[i]));
                return array;
            }
            if (t == Object.class) return s.matches("-?\\d+") ? Integer.valueOf(s) : s;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("“" + s + "” isn't a valid " + t.getSimpleName() + ".");
        }
        throw new IllegalArgumentException("“" + s + "” isn't an object on the bench. Type the name of one, or null.");
    }

    private static String describe(Throwable e) {
        StringBuilder b = new StringBuilder(e.getClass().getName());
        if (e.getMessage() != null) b.append(": ").append(e.getMessage());
        for (StackTraceElement s : e.getStackTrace()) {
            String c = s.getClassName();
            if (c.startsWith("java.") || c.startsWith("jdk.") || c.startsWith("sun.") || c.equals("LogiqBench") || c.startsWith("LogiqBench$")) continue;
            b.append("\n    at ").append(s);
        }
        return b.toString();
    }

    private static String nameOf(Object o) {
        for (Map.Entry<String, Object> e : objects.entrySet()) if (e.getValue() == o) return e.getKey();
        return null;
    }

    private static boolean plain(Object o) {
        return o == null || o instanceof String || o instanceof Number || o instanceof Boolean || o instanceof Character || o instanceof Enum;
    }

    private static String text(Object o, int depth) {
        if (o == null) return "null";
        String ref = nameOf(o);
        if (ref != null) return ref;
        if (o instanceof String) return "\"" + o + "\"";
        if (o instanceof Character) return "'" + o + "'";
        if (o instanceof Enum) return ((Enum<?>) o).name();
        if (plain(o)) return String.valueOf(o);
        if (o.getClass().isArray()) {
            int n = Array.getLength(o);
            StringBuilder b = new StringBuilder("{");
            for (int i = 0; i < Math.min(n, 20); i++) b.append(i > 0 ? ", " : "").append(depth > 1 ? "…" : text(Array.get(o, i), depth + 1));
            return b.append(n > 20 ? ", …}" : "}").toString();
        }
        if (o instanceof Collection) {
            Collection<?> c = (Collection<?>) o;
            StringBuilder b = new StringBuilder(o.getClass().getSimpleName()).append(" (").append(c.size()).append(") [");
            int i = 0;
            for (Object x : c) {
                if (i == 20) {
                    b.append(", …");
                    break;
                }
                b.append(i++ > 0 ? ", " : "").append(depth > 1 ? "…" : text(x, depth + 1));
            }
            return b.append(']').toString();
        }
        if (o instanceof Map) return o.getClass().getSimpleName() + " (" + ((Map<?, ?>) o).size() + ")";
        try {
            if (o.getClass().getMethod("toString").getDeclaringClass() != Object.class) {
                String s = String.valueOf(o);
                return s.length() > 200 ? s.substring(0, 200) + "…" : s;
            }
        } catch (NoSuchMethodException ignored) {
        }
        return o.getClass().getSimpleName() + "@" + Integer.toHexString(System.identityHashCode(o));
    }

    /** A value as JSON: its text, type, the bench name it has, and whether it can be kept. */
    private static String value(Object o, Class<?> declared, boolean result) {
        StringBuilder b = new StringBuilder("{\"text\":").append(json(text(o, 0)));
        b.append(",\"type\":").append(json(o == null || declared.isPrimitive() ? simple(declared) : simple(o.getClass())));
        String ref = o == null ? null : nameOf(o);
        if (ref != null) b.append(",\"ref\":").append(json(ref));
        if (result && o != null && ref == null && !plain(o)) b.append(",\"keepable\":true");
        return b.append('}').toString();
    }

    private static String state() {
        StringBuilder b = new StringBuilder("\"objects\":[");
        boolean first = true;
        for (Map.Entry<String, Object> e : objects.entrySet()) {
            Object o = e.getValue();
            if (!first) b.append(',');
            first = false;
            b.append("{\"name\":").append(json(e.getKey())).append(",\"cls\":").append(json(o.getClass().getName()));
            b.append(",\"simple\":").append(json(o.getClass().getSimpleName())).append(",\"fields\":[");
            boolean ff = true;
            List<Class<?>> chain = new ArrayList<>();
            for (Class<?> c = o.getClass(); c != null && c != Object.class; c = c.getSuperclass()) chain.add(0, c);
            for (Class<?> c : chain) {
                for (Field f : c.getDeclaredFields()) {
                    if (f.isSynthetic()) continue;
                    String v;
                    String ref = null;
                    try {
                        f.setAccessible(true);
                        Object x = f.get(Modifier.isStatic(f.getModifiers()) ? null : o);
                        v = text(x, 0);
                        ref = x == null ? null : nameOf(x);
                    } catch (Throwable t) {
                        v = "?";
                    }
                    if (!ff) b.append(',');
                    ff = false;
                    b.append("{\"name\":").append(json(f.getName())).append(",\"type\":").append(json(simple(f.getType())));
                    b.append(",\"value\":").append(json(v)).append(",\"static\":").append(Modifier.isStatic(f.getModifiers()));
                    b.append(",\"owner\":").append(json(c.getSimpleName()));
                    if (ref != null) b.append(",\"ref\":").append(json(ref));
                    b.append('}');
                }
            }
            b.append("]}");
        }
        return b.append(']').toString();
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
