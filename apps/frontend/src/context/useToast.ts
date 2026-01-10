import { useContext } from "react";
import { ToastContext } from "./toastContextInstance";

function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function useToast() {
  const { pushToast } = useToastContext();
  return { pushToast };
}
