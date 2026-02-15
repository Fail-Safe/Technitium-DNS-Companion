import { useEffect, useState } from "react";

export const formatSnapshotDateTime = (value: string): string => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export const formatSnapshotRelative = (value: string): string => {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;
  const delta = Date.now() - date;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} hr ago`;
  return `${Math.round(delta / 86_400_000)} d ago`;
};

export const useSnapshotDrawerLifecycle = (
  isOpen: boolean,
  onClose: () => void,
): { isActive: boolean; isRendered: boolean } => {
  const [animateIn, setAnimateIn] = useState(false);
  const [animateOut, setAnimateOut] = useState(false);
  const [isRendered, setIsRendered] = useState(isOpen);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setAnimateOut(false);
      const timer = window.setTimeout(() => setAnimateIn(true), 10);
      return () => window.clearTimeout(timer);
    }

    setAnimateIn(false);
    setAnimateOut(true);
    const timeout = window.setTimeout(() => {
      setIsRendered(false);
      setAnimateOut(false);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  const isActive = animateIn && !animateOut;

  return { isActive, isRendered };
};
