import clsx from "clsx";

const styles = {
  ONLINE: "pill pill-online",
  DEGRADED: "pill pill-degraded",
  OFFLINE: "pill pill-offline",
  DEAD: "pill pill-offline"
};

export default function StatusPill({ status }) {
  return (
    <span className={clsx(styles[status] || styles.OFFLINE)}>
      <span
        className={clsx(
          "size-1.5 rounded-full",
          status === "ONLINE" ? "bg-emerald-400" : status === "DEGRADED" ? "bg-amber-400" : "bg-zinc-500"
        )}
      />
      {status || "OFFLINE"}
    </span>
  );
}
