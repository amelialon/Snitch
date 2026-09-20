"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Interviews", match: (p: string) => p === "/" || p.startsWith("/i/") },
  { href: "/live", label: "Live interviews", match: (p: string) => p.startsWith("/live") },
  { href: "/new", label: "New review", match: (p: string) => p.startsWith("/new") },
];

/** The left sidebar: logo, three text links, the active one in weight and colour. */
export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-border px-7 py-7">
      <Link href="/" className="mb-9 block">
        <Image src="/snitch-logo.png" alt="Snitch" width={116} height={29} priority className="h-[26px] w-auto" />
      </Link>
      {ITEMS.map((item) => {
        const on = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={`block py-[7px] text-[14.5px] transition-colors ${on ? "font-medium text-text" : "text-muted hover:text-text"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
