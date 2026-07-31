import { Shell } from "@/components/Shell";
import { AdminSidebar } from "@/components/AdminSidebar";

type AdminShellProps = {
  title: string;
  children: React.ReactNode;
};

export function AdminShell({ title, children }: AdminShellProps) {
  return (
    <Shell title={title} sidebar={<AdminSidebar />}>
      {children}
    </Shell>
  );
}
