/** A full-width disclosure row: title, optional count, chevron. Styled by `.sx` in globals.css. */
export function Section({
  title,
  count,
  open,
  children,
}: {
  title: string;
  count?: number;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="sx" open={open}>
      <summary>
        {title}
        {count != null && <span className="c">{count}</span>}
      </summary>
      <div className="sxb">{children}</div>
    </details>
  );
}
