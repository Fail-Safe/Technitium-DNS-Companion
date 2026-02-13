import { useContext } from "react";
import { TechnitiumContext } from "./technitiumContextInstance";

export function useOptionalTechnitiumState() {
  return useContext(TechnitiumContext);
}

export function useTechnitiumState() {
  const context = useOptionalTechnitiumState();
  if (!context) {
    throw new Error(
      "useTechnitiumState must be used within a TechnitiumProvider",
    );
  }
  return context;
}
