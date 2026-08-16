import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return <div className="fixed inset-x-0 top-0 z-50 flex h-1 overflow-hidden bg-white/5"><span className="w-1/3 animate-[loading_1.1s_ease-in-out_infinite] bg-lime-300" /><span className="sr-only"><LoaderCircle />Loading</span></div>;
}
