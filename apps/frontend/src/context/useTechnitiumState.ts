import { useContext } from "react";
import { TechnitiumContext } from "./technitiumContextInstance";

export function useTechnitiumState() {
  const context = useContext(TechnitiumContext);
  if (!context) {
    throw new Error(
      "useTechnitiumState must be used within a TechnitiumProvider",
    );
  }
  return context;
}
