declare module "*.png" {
  const dataUrl: string;
  export default dataUrl;
}

declare module "*.md" {
  const text: string;
  export default text;
}
