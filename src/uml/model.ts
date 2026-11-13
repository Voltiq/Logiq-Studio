/*
 * The structure of Java code as the UML diagram and the outline see it:
 * types with their fields, methods and the types they extend, implement,
 * hold and create. Method bodies are skipped; only `new X(…)` inside them
 * is noted, as a dependency.
 */

export type Visibility = "public" | "protected" | "package" | "private";
export type TypeKind = "class" | "interface" | "enum" | "record" | "annotation";

export interface JField {
  name: string;
  type: string;
  visibility: Visibility;
  isStatic: boolean;
  isFinal: boolean;
  line: number;
}

export interface JParam {
  name: string;
  type: string;
}

export interface JMethod {
  name: string;
  /** null for constructors. */
  returnType: string | null;
  params: JParam[];
  visibility: Visibility;
  isStatic: boolean;
  isAbstract: boolean;
  isConstructor: boolean;
  typeParams: string;
  line: number;
  /** The line of the body's closing brace (the declaration's line when there is no body). */
  endLine: number;
}

export interface JType {
  name: string;
  /** package.Outer.Name */
  qualifiedName: string;
  kind: TypeKind;
  visibility: Visibility;
  isAbstract: boolean;
  isStatic: boolean;
  isFinal: boolean;
  typeParams: string;
  extends: string[];
  implements: string[];
  fields: JField[];
  methods: JMethod[];
  /** Enum constants. */
  constants: string[];
  /** Types created with `new` in method bodies and initialisers. */
  creates: string[];
  /** Qualified name of the enclosing type, for nested types. */
  outer: string | null;
  path: string;
  package: string;
  line: number;
  endLine: number;
  hasMain: boolean;
  /** The language when it isn't Java ("python"…); such classes are shown, not edited. */
  language?: string;
}

export interface JFile {
  path: string;
  package: string;
  imports: string[];
  types: JType[];
  /** Functions outside any class (Python's module-level functions). */
  functions?: JMethod[];
  /** Runs as a program (Python's `if __name__ == "__main__":`). */
  isMain?: boolean;
}

export const VISIBILITY_SYMBOL: Record<Visibility, string> = {
  public: "+",
  protected: "#",
  package: "~",
  private: "-",
};
