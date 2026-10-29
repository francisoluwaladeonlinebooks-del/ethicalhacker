'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavGroup = { title: string; items: { href: string; label: string; badge?: string }[] };

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="space-y-0.5">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="nav-section">{group.title}</p>
          {group.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={`nav-item ${active ? 'nav-item-active' : ''}`} aria-current={active ? 'page' : undefined}>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge ? <span className="rounded bg-white/15 px-1 font-mono text-2xs text-white/90">{item.badge}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
