"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/create", label: "生成台" },
  { href: "/video", label: "视频" },
  { href: "/library", label: "图库" },
  { href: "/materials", label: "素材库" },
  { href: "/tasks", label: "任务" },
  { href: "/templates", label: "模板" },
  { href: "/settings", label: "设置" },
];

export function TopNav({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <Link href="/create" className="brand">
        <i />
        ADflow
      </Link>
      <nav className="nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname === link.href ? "active" : ""}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      {right}
    </header>
  );
}
