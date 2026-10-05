'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Options = {
  /** Which edge of the anchor the panel lines up with. */
  align?: 'start' | 'end';
  /** Make the panel exactly as wide as the anchor. */
  matchWidth?: boolean;
  /** Changes when the panel's content changes size, so it is re-positioned. */
  layoutKey?: unknown;
};

/**
 * Returns a ref for the panel (an element with popover="manual") and shows it in the browser's top layer, so it floats
 * above dialogs without being clipped. It sits under the anchor, or above it when there is no
 * room, and closes when the page around it scrolls or the window resizes.
 */
export function useAnchoredPopover<T extends HTMLElement>(open: boolean, anchor: RefObject<HTMLElement | null>, onClose: () => void, { align = 'end', matchWidth = false, layoutKey }: Options = {}) {
  const panel = useRef<T>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    const target = anchor.current;
    if (!open || !node || !target) return;
    if (!node.matches(':popover-open')) node.showPopover();
    const rect = target.getBoundingClientRect();
    const gap = 8;
    if (matchWidth) node.style.width = `${rect.width}px`;
    const { offsetWidth: width, offsetHeight: height } = node;
    const below = rect.bottom + gap + height <= window.innerHeight - gap;
    const left = align === 'start' ? rect.left : rect.right - width;
    node.style.top = `${Math.max(gap, below ? rect.bottom + gap : rect.top - gap - height)}px`;
    node.style.left = `${Math.min(Math.max(gap, left), window.innerWidth - width - gap)}px`;
    node.dataset.side = below ? 'bottom' : 'top';
  }, [open, anchor, align, matchWidth, layoutKey]);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', onClose); document.removeEventListener('scroll', onScroll, true); };
  }, [open, onClose]);

  return panel;
}
