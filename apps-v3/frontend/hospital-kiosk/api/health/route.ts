import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Backend health endpoint 호출
    try {
      const response = await fetch("http://localhost:8000/health")
      const healthStatus = await response.json()
      return NextResponse.json(healthStatus)
    } catch (error) {
      console.error("Backend connection error:", error)
      // 백엔드 연결 실패 시 모든 서버 상태를 false로 반환
      return NextResponse.json({ stt: false, llm: false, tts: false })
    }
  } catch (error) {
    console.error("Health check error:", error)
    return NextResponse.json({ stt: false, llm: false, tts: false }, { status: 500 })
  }
}
