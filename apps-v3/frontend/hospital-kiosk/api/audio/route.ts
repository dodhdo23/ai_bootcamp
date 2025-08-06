import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const path = searchParams.get("path")
    const url = searchParams.get("url")

    if (!path && !url) {
      return new Response("Missing path or url parameter", { status: 400 })
    }

    let audioResponse: Response

    if (url) {
      // URL 파라미터가 있으면 해당 URL에서 오디오 가져오기
      audioResponse = await fetch(url)
    } else {
      // path 파라미터가 있으면 백엔드에서 오디오 가져오기
      audioResponse = await fetch(`http://localhost:8000/ttsaudio/${path}`)
    }

    if (!audioResponse.ok) {
      throw new Error(`Failed to fetch audio: ${audioResponse.status}`)
    }

    const audioBuffer = await audioResponse.arrayBuffer()

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    })
  } catch (error) {
    console.error("Audio fetch error:", error)
    return new Response("Failed to fetch audio", { status: 500 })
  }
}
