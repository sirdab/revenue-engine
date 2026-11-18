import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// The list search box every section uses (contacts, activities, …): a plain
// input with the magnifier inside it.
//
// Deliberately NOT `type="search"`: Safari draws a native search field that
// ignores the start padding, so the text lands on top of the icon.
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Sizes the wrapper; defaults to full width on a phone, 240px above. */
  className?: string;
}) {
  return (
    <div className={cn("relative w-full sm:w-[240px]", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full ps-8"
      />
    </div>
  );
}
