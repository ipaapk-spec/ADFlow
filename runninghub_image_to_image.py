#!/usr/bin/env python3
"""RunningHub Nano Banana 2 Lite 图生图：上传、提交、轮询、下载。

依赖安装：.venv/bin/python -m pip install requests python-dotenv
在本文件旁的 .env 中配置：RUNNINGHUB_API_KEY=你的密钥

本地图片：
  .venv/bin/python runninghub_image_to_image.py --image input.jpg \
      --prompt '保留商品外观，将背景替换为简洁的摄影棚' --aspect-ratio 3:4
多张参考图：重复传入 --image，可使用本地路径或公开 HTTP(S) 图片 URL。
恢复查询（不重新提交）：
  .venv/bin/python runninghub_image_to_image.py --task-id 任务ID

模型：https://www.runninghub.ai/call-api/api-detail/2072152437223096321
接口末尾不含 copy；copy 是网页复制按钮文字。该模型不传 resolution。
默认读取 RUNNINGHUB_BASE_URL，未设置时使用 https://www.runninghub.ai。
"""

import argparse
import mimetypes
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv


ENDPOINT = "rhart-image-n-g31-flash-lite/image-to-image"


def post_json(base_url, api_key, endpoint, *, payload=None, files=None):
    """生成提交只调用一次，避免网络超时后重试产生重复付费任务。"""
    response = requests.post(
        f"{base_url}/openapi/v2/{endpoint}",
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
        files=files,
        timeout=(10, 120),
    )
    # 不输出原始响应和请求头，避免错误消息泄露凭证。
    if not response.ok:
        raise RuntimeError(f"{endpoint}: HTTP {response.status_code}，请检查平台调用记录")
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"{endpoint}: 响应不是 JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"{endpoint}: 响应结构无效")
    if data.get("errorCode") not in (None, "", 0, "0"):
        raise RuntimeError(f"{endpoint}: API 错误码 {data['errorCode']}，请检查平台调用记录")
    if data.get("code") not in (None, 0, "0"):
        raise RuntimeError(f"{endpoint}: API 错误码 {data['code']}，请检查平台调用记录")
    return data


def upload_image(base_url, api_key, image):
    if urlparse(image).scheme in ("http", "https"):
        return image
    path = Path(image)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as file:
        result = post_json(
            base_url, api_key, "media/upload/binary",
            files={"file": (path.name, file, mime)},
        )
    data = result.get("data")
    url = data.get("download_url") if isinstance(data, dict) else None
    if not url:
        raise RuntimeError("上传响应缺少 data.download_url")
    return url


def wait_for_result(base_url, api_key, task_id, timeout=1800, interval=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = post_json(base_url, api_key, "query", payload={"taskId": task_id})
        except (requests.Timeout, requests.ConnectionError):
            print("查询网络异常，稍后继续查询", flush=True)
        else:
            status = result.get("status")
            print(f"任务 {task_id}: {status}", flush=True)
            if status == "SUCCESS":
                urls = [item.get("url") or item.get("outputUrl")
                        for item in (result.get("results") or [])
                        if isinstance(item, dict)]
                urls = [url for url in urls if url]
                if not urls:
                    raise RuntimeError("任务成功但未返回图片 URL")
                return urls
            if status not in ("CREATE", "QUEUED", "RUNNING"):
                raise RuntimeError(f"任务终止：{status}，taskId={task_id}，请检查平台调用记录")
        time.sleep(min(interval, max(0, deadline - time.monotonic())))
    raise TimeoutError(f"等待超时，任务仍可能运行。用 --task-id {task_id} 恢复查询")


def download_images(urls, output_dir, task_id):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, url in enumerate(urls, 1):
        # 下载请求不携带 RunningHub API Key。
        with requests.get(url, stream=True, timeout=(10, 120)) as response:
            response.raise_for_status()
            mime = response.headers.get("Content-Type", "").split(";")[0].lower()
            suffix = {"image/jpeg": ".jpg", "image/png": ".png",
                      "image/webp": ".webp"}.get(mime)
            if suffix is None:
                suffix = Path(urlparse(url).path).suffix.lower()
                if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
                    raise RuntimeError("下载响应不是支持的图片类型")
            # 不使用远端任务 ID 拼路径，且不覆盖历史成图。
            path = output_dir / f"result_{index}{suffix}"
            counter = 2
            while path.exists():
                path = output_dir / f"result_{index}_{counter}{suffix}"
                counter += 1
            partial = path.with_suffix(path.suffix + ".part")
            try:
                with partial.open("wb") as file:
                    for chunk in response.iter_content(chunk_size=65536):
                        file.write(chunk)
                if partial.stat().st_size == 0:
                    raise RuntimeError("下载图片为空")
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        paths.append(path.resolve())
        print(f"图片已保存：{path.resolve()}", flush=True)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", action="append", default=[], help="本地图片路径或 URL，可重复，最多10张")
    parser.add_argument("--prompt", help="图片编辑提示词")
    parser.add_argument("--aspect-ratio", default="auto", help="例如 auto、1:1、3:4、9:16")
    parser.add_argument("--task-id", help="只查询已有任务，不提交新任务")
    parser.add_argument("--output-dir", default="temp/runninghub_lite", help="成图保存目录")
    parser.add_argument("--timeout", type=int, default=1800, help="轮询等待秒数，默认1800")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout 必须大于0")
    if not args.task_id:
        if not args.prompt or not args.prompt.strip() or not 1 <= len(args.image) <= 10:
            parser.error("新任务需要非空 --prompt 和1至10个 --image")
        for image in args.image:
            if urlparse(image).scheme not in ("http", "https") and not Path(image).is_file():
                parser.error(f"图片文件不存在：{image}")

    load_dotenv(Path(__file__).resolve().with_name(".env"), override=False)
    api_key = os.environ.get("RUNNINGHUB_API_KEY", "").strip()
    if not api_key:
        parser.error("请在环境变量或本文件旁 .env 配置 RUNNINGHUB_API_KEY")
    base_url = os.environ.get("RUNNINGHUB_BASE_URL", "https://www.runninghub.ai").rstrip("/")
    task_id = args.task_id
    if not task_id:
        urls = [upload_image(base_url, api_key, image) for image in args.image]
        print("正在提交任务；若提交时网络超时，请先检查平台调用记录再决定是否重试", flush=True)
        result = post_json(base_url, api_key, ENDPOINT, payload={
            "imageUrls": urls, "prompt": args.prompt, "aspectRatio": args.aspect_ratio,
        })
        task_id = result.get("taskId") or result.get("task_id")
        if not task_id:
            raise RuntimeError("提交响应缺少 taskId，请检查平台调用记录")
    print(f"taskId={task_id}；可用 --task-id {task_id} 恢复查询", flush=True)
    urls = wait_for_result(base_url, api_key, task_id, timeout=args.timeout)
    download_images(urls, args.output_dir, task_id)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已停止本地等待；远端任务不会取消，可使用 taskId 恢复查询", file=sys.stderr)
        sys.exit(130)
    except (RuntimeError, requests.RequestException, OSError) as exc:
        # requests 异常可能包含签名 URL；仅输出类型。
        message = type(exc).__name__ if isinstance(exc, requests.RequestException) else str(exc)
        print(f"失败：{message}", file=sys.stderr)
        sys.exit(1)
