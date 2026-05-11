export default function MiniBar({ completed = 0, inProgress = 0, total = 0 }) {
  if (!total) return <div className="minibar minibar--empty" />;
  return (
    <div className="minibar">
      <div className="minibar__segment minibar__segment--done"  style={{ width: `${(completed  / total) * 100}%` }} />
      <div className="minibar__segment minibar__segment--wip"   style={{ width: `${(inProgress / total) * 100}%` }} />
    </div>
  );
}
