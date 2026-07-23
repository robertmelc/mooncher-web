export default function EndUserLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div data-scope="app">{children}</div>;
}
