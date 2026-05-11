import path from "node:path";

export const toPosixPath = (value: string): string => value.split(path.sep).join("/");

export const toRelativePath = (filePath: string, rootDirectory: string): string => {
  const relativePath = path.relative(rootDirectory, filePath);
  return toPosixPath(relativePath.length > 0 ? relativePath : path.basename(filePath));
};
