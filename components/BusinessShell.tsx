import { Shell } from "@/components/Shell";
import { BusinessSidebar } from "@/components/BusinessSidebar";

type BusinessShellProps = {
  title: string;
  children: React.ReactNode;
};

export function BusinessShell({ title, children }: BusinessShellProps) {
  return (
    <Shell title={title} sidebar={<BusinessSidebar />}>
      {children}
    </Shell>
  );
}
