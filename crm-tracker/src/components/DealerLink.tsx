import { ReactNode } from 'react';
import clsx from 'clsx';
import { useDealerProfile } from './filters';
import { isValidatedDealerKey } from '../lib/nav/links';

/**
 * A dealer name that opens the dealer profile. It only becomes a link when the dealer has a validated ERP code;
 * a name-only record stays plain text because names are never a safe way to find a dealer's records.
 */
export function DealerLink({ dealerKey, children, tab, className }: { dealerKey: string | null | undefined; children: ReactNode; tab?: string; className?: string }) {
  const { open } = useDealerProfile();
  if (!isValidatedDealerKey(dealerKey)) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      title="Open dealer profile"
      className={clsx('text-left font-medium text-hero-700 underline-offset-2 hover:underline focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-hero-600', className)}
      onClick={(e) => {
        e.stopPropagation();
        open(dealerKey, tab);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}
