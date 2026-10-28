"use client";

/**
 * 图形化的「赞」按钮：竖大拇指图标，赞过变实心高亮。
 * 只负责展示与点击，状态由调用方维护（数据层字段仍叫 favorite）。
 */
export function LikeButton({
  liked,
  onClick,
  size = 16,
  label,
  className,
}: {
  liked: boolean;
  onClick: () => void;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`like${liked ? " on" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      aria-pressed={liked}
      aria-label={liked ? "取消赞" : "赞"}
      title={liked ? "取消赞" : "赞"}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 10v12" />
        <path
          d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
          fill={liked ? "currentColor" : "none"}
        />
      </svg>
      {label && <span>{label}</span>}
    </button>
  );
}
