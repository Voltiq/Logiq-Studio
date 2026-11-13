import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Logiq Studio's debugger. It launches the program under JDI, sets
 * breakpoints, steps, and reports the call stack and variables when the
 * program stops. With tracing on, it records every call between the
 * project's classes for a sequence diagram instead.
 *
 * Requests (one per line, fields separated by \u001F, \\ and \n escaped):
 *   launch  mainClass classPath trace(0|1) projectClasses(a,b) breakpoints(Cls:line,...) vmOptions args...
 *   break   class line on(0|1)
 *   resume | over | into | out | pause | stop
 *   frame   index                       (variables of another frame)
 *   expand  objectId                    (fields or elements)
 *   eval    frameIndex expression       (a.b[2].c)
 *   input   text                        (to the program's System.in)
 * Events: one JSON line each, starting with \u0001LOGIQ.
 */
public class LogiqDebug {

    private static final PrintStream OUT = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
    private static final Object lock = new Object();
    private static VirtualMachine vm;
    private static Process process;
    private static final Map<String, Set<Integer>> breakpoints = new HashMap<>();
    private static final Map<String, List<BreakpointRequest>> active = new HashMap<>();
    private static ThreadReference stopped;
    private static final Map<Long, ObjectReference> objects = new HashMap<>();
    private static boolean trace;
    private static Set<String> project = new HashSet<>();
    private static final List<String> calls = new ArrayList<>();
    private static final Map<Long, Deque<String>> callers = new HashMap<>();
    private static final Map<Long, String> participants = new LinkedHashMap<>();
    private static final Map<String, Integer> counters = new HashMap<>();
    /** Participants in the order they first take part. */
    private static final List<String> order = new ArrayList<>();
    private static final int MAX_CALLS = 2000;

    public static void main(String[] a) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String line; (line = in.readLine()) != null; ) {
            String[] f = split(line);
            try {
                handle(f);
            } catch (Throwable e) {
                emit("{\"event\":\"error\",\"message\":" + json(String.valueOf(e.getMessage() != null ? e.getMessage() : e.toString())) + "}");
            }
        }
        if (vm != null) {
            try {
                vm.exit(1);
            } catch (Throwable ignored) {
            }
        }
    }

    static void emit(String json) {
        synchronized (lock) {
            OUT.print("\u0001LOGIQ ");
            OUT.println(json);
            OUT.flush();
        }
    }

    static String[] split(String line) {
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

    static void handle(String[] f) throws Exception {
        switch (f[0]) {
            case "launch": launch(f); break;
            case "break": setBreakpoint(f[1], Integer.parseInt(f[2]), f[3].equals("1")); break;
            case "resume": resume(); break;
            case "over": step(StepRequest.STEP_OVER); break;
            case "into": step(StepRequest.STEP_INTO); break;
            case "out": step(StepRequest.STEP_OUT); break;
            case "pause": pause(); break;
            case "stop":
                if (vm != null) vm.exit(1);
                break;
            case "frame": synchronized (lock) { if (stopped != null) emit(stoppedJson("frame", Integer.parseInt(f[1]), null)); } break;
            case "expand": expand(Long.parseLong(f[1])); break;
            case "eval": eval(Integer.parseInt(f[1]), f[2]); break;
            case "input":
                if (process != null) {
                    OutputStream o = process.getOutputStream();
                    o.write(f[1].getBytes(StandardCharsets.UTF_8));
                    o.flush();
                }
                break;
            default: throw new IllegalArgumentException("Unknown request " + f[0]);
        }
    }

    // ----- Launching ------------------------------------------------------------------

    static void launch(String[] f) throws Exception {
        String main = f[1], cp = f[2];
        trace = f[3].equals("1");
        project = new HashSet<>(Arrays.asList(f[4].isEmpty() ? new String[0] : f[4].split(",")));
        if (!f[5].isEmpty()) for (String b : f[5].split(",")) {
            int i = b.lastIndexOf(':');
            breakpoints.computeIfAbsent(b.substring(0, i), k -> new TreeSet<>()).add(Integer.parseInt(b.substring(i + 1)));
        }
        StringBuilder mainArg = new StringBuilder(main);
        for (int i = 7; i < f.length; i++) mainArg.append(' ').append(quote(f[i]));
        LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> args = connector.defaultArguments();
        args.get("main").setValue(mainArg.toString());
        args.get("options").setValue("-cp " + quote(cp) + " -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 " + f[6]);
        if (args.containsKey("suspend")) args.get("suspend").setValue("true");
        vm = connector.launch(args);
        process = vm.process();
        pump(process.getInputStream(), "stdout");
        pump(process.getErrorStream(), "stderr");
        EventRequestManager erm = vm.eventRequestManager();
        // Breakpoints in classes that load later are set when they do.
        for (String cls : breakpoints.keySet()) prepareWatch(cls);
        for (ReferenceType t : vm.allClasses()) placeBreakpoints(t);
        // Uncaught exceptions stop the program where they are thrown.
        ExceptionRequest ex = erm.createExceptionRequest(null, false, true);
        ex.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        ex.enable();
        if (trace) {
            // Class filters on one request must all match, so each class (and its nested ones) gets its own.
            for (String c : project) {
                for (String pattern : new String[] {c, c + "$*"}) {
                    MethodEntryRequest me = erm.createMethodEntryRequest();
                    me.addClassFilter(pattern);
                    me.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                    me.enable();
                    MethodExitRequest mx = erm.createMethodExitRequest();
                    mx.addClassFilter(pattern);
                    mx.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                    mx.enable();
                }
            }
        }
        Thread loop = new Thread(LogiqDebug::eventLoop, "logiq-events");
        loop.setDaemon(true);
        loop.start();
        emit("{\"event\":\"started\"}");
        vm.resume();
    }

    static String quote(String s) {
        return s.contains(" ") || s.isEmpty() ? "\"" + s + "\"" : s;
    }

    static void pump(InputStream s, String stream) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[4096];
            try {
                ByteArrayOutputStream pending = new ByteArrayOutputStream();
                for (int n; (n = s.read(buf)) > 0; ) {
                    pending.write(buf, 0, n);
                    String text = decodeComplete(pending);
                    if (!text.isEmpty()) emit("{\"event\":\"output\",\"stream\":\"" + stream + "\",\"text\":" + json(text) + "}");
                }
            } catch (IOException ignored) {
            }
        });
        t.setDaemon(true);
        t.start();
    }

    /** Takes the complete UTF-8 characters out of the buffer, leaving a split one for the next read. */
    static String decodeComplete(ByteArrayOutputStream pending) {
        byte[] b = pending.toByteArray();
        int end = b.length;
        int back = 0;
        while (back < 3 && end - back - 1 >= 0 && (b[end - back - 1] & 0xC0) == 0x80) back++;
        if (end - back - 1 >= 0) {
            int lead = b[end - back - 1] & 0xFF;
            int need = lead >= 0xF0 ? 3 : lead >= 0xE0 ? 2 : lead >= 0xC0 ? 1 : 0;
            if (need > back) end = end - back - 1;
        }
        String text = new String(b, 0, end, StandardCharsets.UTF_8);
        pending.reset();
        pending.write(b, end, b.length - end);
        return text;
    }

    static void prepareWatch(String cls) {
        ClassPrepareRequest r = vm.eventRequestManager().createClassPrepareRequest();
        r.addClassFilter(cls);
        r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        r.enable();
    }

    static void placeBreakpoints(ReferenceType t) {
        // Nested classes have the lines of the file of their outer class.
        String outer = t.name().contains("$") ? t.name().substring(0, t.name().indexOf('$')) : t.name();
        Set<Integer> lines = breakpoints.get(outer);
        if (lines == null) return;
        for (int line : lines) placeOne(t, outer, line);
    }

    static void placeOne(ReferenceType t, String outer, int line) {
        try {
            for (Location loc : t.locationsOfLine(line)) {
                BreakpointRequest r = vm.eventRequestManager().createBreakpointRequest(loc);
                r.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                r.putProperty("line", line);
                r.enable();
                active.computeIfAbsent(outer, k -> new ArrayList<>()).add(r);
            }
        } catch (AbsentInformationException | ClassNotPreparedException ignored) {
        }
    }

    static void setBreakpoint(String cls, int line, boolean on) {
        if (on) {
            if (breakpoints.computeIfAbsent(cls, k -> new TreeSet<>()).add(line) && vm != null) {
                for (ReferenceType t : vm.allClasses()) {
                    String n = t.name();
                    if (n.equals(cls) || n.startsWith(cls + "$")) placeOne(t, cls, line);
                }
                prepareWatch(cls);
            }
        } else {
            Set<Integer> lines = breakpoints.get(cls);
            if (lines != null) lines.remove(line);
            List<BreakpointRequest> list = active.get(cls);
            if (list != null && vm != null) {
                for (Iterator<BreakpointRequest> it = list.iterator(); it.hasNext(); ) {
                    BreakpointRequest r = it.next();
                    if (Integer.valueOf(line).equals(r.getProperty("line"))) {
                        vm.eventRequestManager().deleteEventRequest(r);
                        it.remove();
                    }
                }
            }
        }
    }

    // ----- Running and stepping --------------------------------------------------------

    static void resume() {
        synchronized (lock) {
            if (vm == null || stopped == null) return;
            stopped = null;
            objects.clear();
        }
        emit("{\"event\":\"resumed\"}");
        vm.resume();
    }

    static void step(int depth) {
        ThreadReference t;
        synchronized (lock) {
            if (vm == null || stopped == null) return;
            t = stopped;
        }
        EventRequestManager erm = vm.eventRequestManager();
        erm.deleteEventRequests(erm.stepRequests());
        StepRequest r = erm.createStepRequest(t, StepRequest.STEP_LINE, depth);
        for (String p : new String[] {"java.*", "javax.*", "jdk.*", "sun.*", "com.sun.*"}) r.addClassExclusionFilter(p);
        r.addCountFilter(1);
        r.setSuspendPolicy(EventRequest.SUSPEND_ALL);
        r.enable();
        resume();
    }

    static void pause() {
        if (vm == null) return;
        vm.suspend();
        ThreadReference main = null;
        for (ThreadReference t : vm.allThreads()) {
            if (t.name().equals("main")) main = t;
        }
        if (main == null) return;
        synchronized (lock) {
            stopped = main;
            emit(stoppedJson("pause", 0, null));
        }
    }

    static void eventLoop() {
        EventQueue q = vm.eventQueue();
        try {
            while (true) {
                EventSet set = q.remove();
                boolean resume = true;
                for (Event e : set) {
                    if (e instanceof ClassPrepareEvent) {
                        placeBreakpoints(((ClassPrepareEvent) e).referenceType());
                    } else if (e instanceof BreakpointEvent || e instanceof StepEvent) {
                        if (e instanceof StepEvent) vm.eventRequestManager().deleteEventRequest(e.request());
                        resume = false;
                        synchronized (lock) {
                            stopped = ((LocatableEvent) e).thread();
                            emit(stoppedJson(e instanceof StepEvent ? "step" : "breakpoint", 0, null));
                        }
                    } else if (e instanceof ExceptionEvent) {
                        resume = false;
                        ExceptionEvent ee = (ExceptionEvent) e;
                        synchronized (lock) {
                            stopped = ee.thread();
                            emit(stoppedJson("exception", 0, describe(ee.exception())));
                        }
                    } else if (e instanceof MethodEntryEvent) {
                        traceEntry((MethodEntryEvent) e);
                    } else if (e instanceof MethodExitEvent) {
                        traceExit((MethodExitEvent) e);
                    } else if (e instanceof VMDeathEvent || e instanceof VMDisconnectEvent) {
                        finish();
                        return;
                    }
                }
                if (resume) set.resume();
            }
        } catch (InterruptedException | VMDisconnectedException e) {
            finish();
        }
    }

    static boolean finished;

    static void finish() {
        synchronized (lock) {
            if (finished) return;
            finished = true;
        }
        int code = -1;
        try {
            code = process.waitFor();
        } catch (InterruptedException ignored) {
        }
        if (trace) {
            StringBuilder b = new StringBuilder("{\"event\":\"trace\",\"participants\":[");
            int i = 0;
            for (String p : order) b.append(i++ > 0 ? "," : "").append(json(p));
            b.append("],\"calls\":[").append(String.join(",", calls)).append("],\"truncated\":").append(calls.size() >= MAX_CALLS).append('}');
            emit(b.toString());
        }
        // Let the output pumps empty their buffers first.
        try {
            Thread.sleep(150);
        } catch (InterruptedException ignored) {
        }
        emit("{\"event\":\"exited\",\"code\":" + code + "}");
        System.exit(0);
    }

    // ----- Tracing for sequence diagrams ------------------------------------------------

    static String participant(ObjectReference o, ReferenceType type) {
        if (o == null) return type.name();
        String name = participants.get(o.uniqueID());
        if (name == null) {
            String simple = o.referenceType().name().replaceAll("^.*[.$]", "");
            int n = counters.merge(simple, 1, Integer::sum);
            name = simple.substring(0, 1).toLowerCase() + simple.substring(1) + n + ":" + simple;
            participants.put(o.uniqueID(), name);
        }
        return name;
    }

    static void traceEntry(MethodEntryEvent e) {
        if (calls.size() >= MAX_CALLS) return;
        try {
            ThreadReference t = e.thread();
            Method m = e.method();
            if (m.isSynthetic() || m.isStaticInitializer()) return;
            StackFrame frame = t.frame(0);
            String callee = participant(m.isStatic() ? null : frame.thisObject(), m.declaringType());
            Deque<String> stack = callers.computeIfAbsent(t.uniqueID(), k -> new ArrayDeque<>());
            String caller = stack.isEmpty() ? "actor" : stack.peek();
            StringBuilder args = new StringBuilder();
            try {
                for (Value v : frame.getArgumentValues()) args.append(args.length() > 0 ? ", " : "").append(shortText(v));
            } catch (Throwable ignored) {
            }
            String name = m.isConstructor() ? "new" : m.name();
            calls.add("{\"kind\":\"call\",\"from\":" + json(caller) + ",\"to\":" + json(callee) + ",\"method\":" + json(name) + ",\"args\":" + json(args.toString()) + ",\"depth\":" + stack.size() + "}");
            if (!order.contains(caller)) order.add(caller);
            if (!order.contains(callee)) order.add(callee);
            stack.push(callee);
        } catch (IncompatibleThreadStateException ignored) {
        }
    }

    static void traceExit(MethodExitEvent e) {
        Deque<String> stack = callers.get(e.thread().uniqueID());
        if (stack == null || stack.isEmpty()) return;
        String callee = stack.pop();
        if (calls.size() >= MAX_CALLS) return;
        String caller = stack.isEmpty() ? "actor" : stack.peek();
        Method m = e.method();
        String value = "";
        try {
            if (!m.returnTypeName().equals("void") && !m.isConstructor()) value = shortText(e.returnValue());
        } catch (Throwable ignored) {
        }
        calls.add("{\"kind\":\"return\",\"from\":" + json(callee) + ",\"to\":" + json(caller) + ",\"method\":" + json(m.isConstructor() ? "new" : m.name()) + ",\"value\":" + json(value) + ",\"depth\":" + stack.size() + "}");
    }

    // ----- Values --------------------------------------------------------------------

    static String shortText(Value v) {
        if (v == null) return "null";
        if (v instanceof StringReference) {
            String s = ((StringReference) v).value();
            return "\"" + (s.length() > 40 ? s.substring(0, 40) + "…" : s) + "\"";
        }
        if (v instanceof PrimitiveValue) return v.toString();
        ObjectReference o = (ObjectReference) v;
        String boxed = boxedValue(o);
        if (boxed != null) return boxed;
        String p = participants.get(o.uniqueID());
        return p != null ? p.substring(0, p.indexOf(':')) : o.referenceType().name().replaceAll("^.*[.$]", "");
    }

    static String boxedValue(ObjectReference o) {
        String n = o.referenceType().name();
        if (n.startsWith("java.lang.") && (n.endsWith("Integer") || n.endsWith("Long") || n.endsWith("Double") || n.endsWith("Float") || n.endsWith("Short") || n.endsWith("Byte") || n.endsWith("Boolean") || n.endsWith("Character"))) {
            Field f = o.referenceType().fieldByName("value");
            if (f != null) return String.valueOf(o.getValue(f));
        }
        if (o.referenceType() instanceof ClassType && ((ClassType) o.referenceType()).isEnum()) {
            Field f = ((ClassType) o.referenceType()).fieldByName("name");
            if (f != null) {
                Value name = o.getValue(f);
                if (name instanceof StringReference) return ((StringReference) name).value();
            }
        }
        return null;
    }

    static String valueJson(String name, String type, Value v) {
        StringBuilder b = new StringBuilder("{\"name\":").append(json(name)).append(",\"type\":").append(json(type));
        if (v == null) return b.append(",\"value\":\"null\"}").toString();
        if (v instanceof StringReference) return b.append(",\"value\":").append(json("\"" + ((StringReference) v).value() + "\"")).append('}').toString();
        if (v instanceof PrimitiveValue) return b.append(",\"value\":").append(json(v.toString())).append('}').toString();
        ObjectReference o = (ObjectReference) v;
        String boxed = boxedValue(o);
        if (boxed != null) return b.append(",\"value\":").append(json(boxed)).append('}').toString();
        objects.put(o.uniqueID(), o);
        String simple = o.referenceType().name().replaceAll("^.*\\.", "");
        String text;
        if (o instanceof ArrayReference) text = simple.replace("[]", "[" + ((ArrayReference) o).length() + "]");
        else {
            Integer size = collectionSize(o);
            text = size != null ? simple + " (" + size + ")" : simple;
        }
        return b.append(",\"value\":").append(json(text + " #" + o.uniqueID())).append(",\"id\":").append(o.uniqueID()).append('}').toString();
    }

    static Integer collectionSize(ObjectReference o) {
        Field f = o.referenceType().fieldByName("size");
        if (f != null && o.getValue(f) instanceof IntegerValue && o.referenceType().name().startsWith("java.util.")) return ((IntegerValue) o.getValue(f)).value();
        return null;
    }

    /** The elements of an ArrayList, the entries of an array, or the fields of any other object. */
    static void expand(long id) {
        ObjectReference o = objects.get(id);
        if (o == null) return;
        StringBuilder b = new StringBuilder("{\"event\":\"children\",\"id\":").append(id).append(",\"children\":[");
        List<String> items = new ArrayList<>();
        if (o instanceof ArrayReference) {
            ArrayReference a = (ArrayReference) o;
            String ct = a.referenceType().name().replaceAll("^.*\\.", "").replaceFirst("\\[\\]$", "");
            List<Value> vals = a.getValues(0, Math.min(a.length(), 200));
            for (int i = 0; i < vals.size(); i++) items.add(valueJson("[" + i + "]", ct, vals.get(i)));
        } else if (o.referenceType().name().equals("java.util.ArrayList")) {
            Field data = o.referenceType().fieldByName("elementData");
            int size = collectionSize(o);
            ArrayReference arr = (ArrayReference) o.getValue(data);
            for (int i = 0; i < Math.min(size, 200); i++) items.add(valueJson("[" + i + "]", "Object", arr.getValue(i)));
        } else {
            for (Field f : o.referenceType().allFields()) {
                if (f.isStatic() || f.isSynthetic()) continue;
                items.add(valueJson(f.name(), f.typeName().replaceAll("^.*\\.", ""), o.getValue(f)));
            }
        }
        emit(b.append(String.join(",", items)).append("]}").toString());
    }

    static String stoppedJson(String reason, int frameIndex, String exception) {
        StringBuilder b = new StringBuilder("{\"event\":\"stopped\",\"reason\":").append(json(reason));
        if (exception != null) b.append(",\"exception\":").append(json(exception));
        b.append(",\"thread\":").append(json(stopped.name())).append(",\"frame\":").append(frameIndex).append(",\"frames\":[");
        try {
            List<StackFrame> frames = stopped.frames();
            int i = 0;
            for (StackFrame fr : frames) {
                Location l = fr.location();
                String src = "";
                try {
                    src = l.sourceName();
                } catch (AbsentInformationException ignored) {
                }
                if (i > 0) b.append(',');
                b.append("{\"cls\":").append(json(l.declaringType().name())).append(",\"method\":").append(json(l.method().name()));
                b.append(",\"line\":").append(l.lineNumber()).append(",\"source\":").append(json(src)).append('}');
                if (++i >= 64) break;
            }
            b.append("],\"variables\":[");
            if (frameIndex < frames.size()) b.append(variables(frames.get(frameIndex)));
            b.append("]");
        } catch (IncompatibleThreadStateException e) {
            b.append("],\"variables\":[]");
        }
        return b.append('}').toString();
    }

    static String variables(StackFrame fr) {
        List<String> items = new ArrayList<>();
        ObjectReference self = fr.thisObject();
        if (self != null) items.add(valueJson("this", self.referenceType().name().replaceAll("^.*\\.", ""), self));
        try {
            for (LocalVariable v : fr.visibleVariables()) items.add(valueJson(v.name(), v.typeName().replaceAll("^.*\\.", ""), fr.getValue(v)));
        } catch (AbsentInformationException e) {
            items.add("{\"name\":\"(no variable names)\",\"type\":\"\",\"value\":\"compile with -g\"}");
        }
        return String.join(",", items);
    }

    /** A watch: a variable, field path and array index, like shapes[0].x or this.name. */
    static void eval(int frameIndex, String expr) {
        String result;
        try {
            if (stopped == null) throw new IllegalStateException("The program isn't paused.");
            StackFrame fr = stopped.frame(frameIndex);
            String[] parts = expr.trim().split("\\.");
            Value cur = null;
            for (int i = 0; i < parts.length; i++) {
                String p = parts[i].trim();
                List<Integer> idx = new ArrayList<>();
                while (p.endsWith("]")) {
                    int open = p.lastIndexOf('[');
                    idx.add(0, Integer.parseInt(p.substring(open + 1, p.length() - 1).trim()));
                    p = p.substring(0, open).trim();
                }
                if (i == 0) {
                    if (p.equals("this")) cur = fr.thisObject();
                    else {
                        LocalVariable lv = fr.visibleVariableByName(p);
                        if (lv != null) cur = fr.getValue(lv);
                        else {
                            ReferenceType t = fr.location().declaringType();
                            Field fld = t.fieldByName(p);
                            if (fld == null) throw new IllegalArgumentException("“" + p + "” isn't known here.");
                            cur = fld.isStatic() ? t.getValue(fld) : fr.thisObject().getValue(fld);
                        }
                    }
                } else {
                    if (!(cur instanceof ObjectReference)) throw new IllegalArgumentException("“" + parts[i - 1] + "” has no fields.");
                    ObjectReference o = (ObjectReference) cur;
                    if (o instanceof ArrayReference && p.equals("length")) {
                        cur = vm.mirrorOf(((ArrayReference) o).length());
                    } else {
                        Field fld = o.referenceType().fieldByName(p);
                        if (fld == null) throw new IllegalArgumentException(o.referenceType().name().replaceAll("^.*\\.", "") + " has no field “" + p + "”.");
                        cur = o.getValue(fld);
                    }
                }
                for (int k : idx) {
                    if (cur instanceof ArrayReference) cur = ((ArrayReference) cur).getValue(k);
                    else if (cur instanceof ObjectReference && ((ObjectReference) cur).referenceType().name().equals("java.util.ArrayList")) {
                        ObjectReference list = (ObjectReference) cur;
                        cur = ((ArrayReference) list.getValue(list.referenceType().fieldByName("elementData"))).getValue(k);
                    } else throw new IllegalArgumentException("Only arrays and ArrayLists have [ ].");
                }
            }
            result = valueJson(expr, cur == null ? "" : cur.type().name().replaceAll("^.*\\.", ""), cur);
        } catch (Throwable e) {
            result = "{\"name\":" + json(expr) + ",\"type\":\"\",\"value\":" + json(e.getMessage() != null ? e.getMessage() : e.toString()) + ",\"error\":true}";
        }
        emit("{\"event\":\"watch\",\"value\":" + result + "}");
    }

    static String describe(ObjectReference ex) {
        String type = ex.referenceType().name();
        Field msg = ex.referenceType().fieldByName("detailMessage");
        Value m = msg == null ? null : ex.getValue(msg);
        return m instanceof StringReference ? type + ": " + ((StringReference) m).value() : type;
    }

    static String json(String s) {
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
