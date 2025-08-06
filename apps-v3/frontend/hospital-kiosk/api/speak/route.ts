import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json()

    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 })
    }

    try {
      // Backend speak endpoint 호출
      const response = await fetch("http://localhost:8000/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      const data = await response.json()

      return NextResponse.json({
        audio_path: data.audio_path,
        message: "TTS generated successfully",
      })
    } catch (error) {
      console.error("Backend connection error:", error)
      // 백엔드 연결 실패 시 시뮬레이션 응답
      return NextResponse.json({
        audio_path: `simulated_${Date.now()}.mp3`,
        message: "TTS simulated (backend unavailable)",
        simulated: true,
      })
    }
  } catch (error) {
    console.error("TTS error:", error)
    return NextResponse.json(
      {
        error: "TTS generation failed",
        simulated: true,
      },
      { status: 500 },
    )
  }
}
