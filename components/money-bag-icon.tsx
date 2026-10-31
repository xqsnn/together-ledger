import type { SVGProps } from 'react';

type MoneyBagIconProps = SVGProps<SVGSVGElement> & {
  /** 图标边长，默认与 lucide 图标一致。 */
  size?: number;
  strokeWidth?: number;
};

/**
 * 钱袋图标：用于「记收入」快捷入口。
 * 采用 lucide 的 24px 线性风格，袋身用 16% 的当前色填充，小尺寸下轮廓更清晰。
 */
export function MoneyBagIcon({ size = 20, strokeWidth = 2, ...props }: MoneyBagIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        fillOpacity={0.16}
        d="M8.6 3.4c.7.9 1.1 2.2 1.2 3.5-3.3 1.9-5.4 5.3-5.4 9.2 0 3.5 3.2 5.2 7.6 5.2s7.6-1.7 7.6-5.2c0-3.9-2.1-7.3-5.4-9.2.1-1.3.5-2.6 1.2-3.5-1 .3-2.1 1-3.4 1s-2.4-.7-3.4-1Z"
      />
      <path d="M9.4 6.7h5.2" />
    </svg>
  );
}
