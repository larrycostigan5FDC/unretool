export interface CompileOptions {
  out?: string;
}

export async function compile(dir: string, options: CompileOptions): Promise<void> {
  void dir;
  void options;
  throw new Error("compile is not implemented yet");
}
