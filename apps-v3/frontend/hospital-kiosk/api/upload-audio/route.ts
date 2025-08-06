import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    try {
      // Backend upload endpoint 호출
      const backendFormData = new FormData()
      backendFormData.append("file", file)

      const response = await fetch("http://localhost:8000/upload-audio/", {
        method: "POST",
        body: backendFormData,
      })

      const data = await response.json()

      return NextResponse.json({
        file_id: data.file_id,
        message: "File uploaded successfully",
      })
    } catch (error) {
      console.error("Backend connection error:", error)
      // 백엔드 연결 실패 시 시뮬레이션 응답
      return NextResponse.json({
        file_id: `simulated_${Date.now()}`,
        message: "File upload simulated (backend unavailable)",
        simulated: true,
      })
    }
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
