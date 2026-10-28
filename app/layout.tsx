import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/top-nav";
import { StatsPill } from "@/components/stats-pill";

export const metadata: Metadata = {
  title: "ADflow · AI 图片生成工作台",
  description: "文生图、图生图、局部重绘，本地运行的个人出图流水线",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <TopNav right={<StatsPill />} />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
