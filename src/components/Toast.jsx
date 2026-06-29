import { toast } from "../store.js";

export function Toast() {
  if (!toast.value) return null;
  return <div class="toast">{toast.value}</div>;
}
