import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getRequestContext, type RequestContext } from '@/lib/db/context';
import { withScope, type Tx } from '@/lib/db/pool';
import { can, type Permission } from '@/lib/rbac';
import { ForbiddenError } from '@/lib/errors';

/**
 * Server-component helper: resolve the request context, enforce a page level
 * permission, and provide a scoped query runner.
 */
export async function pageContext(permission?: Permission | Permission[]): Promise<RequestContext> {
  const ctx = await getRequestContext({ required: false });
  if (!ctx) redirect('/login');
  if (permission) {
    const required = Array.isArray(permission) ? permission : [permission];
    if (!required.some((permission) => can(ctx.user, permission))) {
      throw new ForbiddenError('You do not have access to this area of the platform.');
    }
  }
  return ctx;
}

export async function query<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withScope(ctx.scope, fn);
}

export function ensure(condition: unknown, message = 'You do not have permission to perform this action'): asserts condition {
  if (!condition) throw new ForbiddenError(message);
}

export function canDo(ctx: RequestContext, permission: Permission): boolean {
  return can(ctx.user, permission);
}

export function flashFrom(searchParams: Record<string, string | string[] | undefined>): { notice?: string; error?: string } {
  const one = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return { notice: one('notice'), error: one('error') };
}

export function pageNumber(searchParams: Record<string, string | string[] | undefined>): number {
  const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const value = Number(raw ?? 1);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function param(searchParams: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export const PAGE_SIZE = 20;

export type WithChildren = { children: ReactNode };
