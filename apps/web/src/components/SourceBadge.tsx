import { FlaskConical, ScanLine } from "lucide-react";
export function SourceBadge({ source }: { source: "mock" | "presage" }) {
  return (
    <span
      className={`badge source ${source === "mock" ? "synthetic" : "real"}`}
    >
      {source === "mock" ? <FlaskConical size={13} /> : <ScanLine size={13} />}{" "}
      {source === "mock" ? "Synthetic demo" : "Presage measurement"}
    </span>
  );
}
