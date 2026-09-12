import { Toaster as Sonner } from "sonner";
// Patches toast.error to stay on screen until dismissed (see lib/toast.ts) — imported for its
// side effect, not any export used directly here. Must run before any toast fires; importing it
// wherever the Toaster itself is set up guarantees that.
import "@/lib/toast";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      // A plain confirmation ("Transaction updated") auto-dismisses after 5s — long enough to
      // read, short enough not to pile up. An error stays until dismissed (lib/toast.ts patches
      // toast.error specifically for that) since it's easy to miss entirely at 5s, especially a
      // duplicate warning with something to actually read and decide on.
      duration={5000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
