"use client"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Mic,
  Volume2,
  CheckCircle,
  XCircle,
  Square,
  Plus,
  Cross,
  FileText,
  MapPin,
  ClipboardList,
  Phone,
  RotateCcw,
  ArrowLeft,
  VolumeX,
  Zap,
  Settings,
} from "lucide-react"

interface HealthStatus {
  stt: boolean
  llm: boolean
  tts: boolean
}

interface WebSocketMessage {
  stage: "status" | "stt" | "llm" | "tts" | "error"
  text?: string
  audio_url?: string
}

interface UserInfo {
  name: string
  phone: string
  address: string
  symptom: string
}

interface ReceptionInfo {
  dept: string
  date: string
  time: string
}

type ServiceType = "reception" | "lookup" | "direction"
type ReceptionStep =
  | "name"
  | "confirmName"
  | "phone"
  | "confirmPhone"
  | "address"
  | "confirmAddress"
  | "symptom"
  | "confirmTriage"
  | "finish"
type LookupStep = "lookupName" | "lookupPhone" | "showResult"
type DirectionStep = "direction" | "showDirection"

export default function HospitalKiosk() {
  // Screen states - 처음에 모드 선택부터 시작
  const [currentScreen, setCurrentScreen] = useState<"modeSelect" | "start" | "main" | "service">("modeSelect")
  const [currentService, setCurrentService] = useState<ServiceType | null>(null)
  const [currentStep, setCurrentStep] = useState<ReceptionStep | LookupStep | DirectionStep | null>(null)

  // Mode selection - null means not selected yet
  const [isSimulationMode, setIsSimulationMode] = useState<boolean | null>(null)

  // User data
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "",
    phone: "",
    address: "",
    symptom: "",
  })
  const [lookupInfo, setLookupInfo] = useState({ name: "", phone: "" })
  const [predictedDept, setPredictedDept] = useState("")
  const [receptionResult, setReceptionResult] = useState<ReceptionInfo | null>(null)

  // Processing states
  const [status, setStatus] = useState("대기 중")
  const [isLoading, setIsLoading] = useState(false)
  const [sttText, setSttText] = useState("")
  const [llmText, setLlmText] = useState("")
  const [ttsText, setTtsText] = useState("")
  const [ttsDisplayText, setTtsDisplayText] = useState("원하시는 모드를 선택해주세요")

  // Audio and recording states
  const [isRecording, setIsRecording] = useState(false)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({ stt: false, llm: false, tts: false })
  const [isTTSPlaying, setIsTTSPlaying] = useState(false)

  // Error handling states
  const [errorCount, setErrorCount] = useState(0)
  const [retryCount, setRetryCount] = useState(0)

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recordingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const ttsTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Typewriter effect for LLM text
  const [displayedLlmText, setDisplayedLlmText] = useState("")
  const [subtitleProgress, setSubtitleProgress] = useState(0)
  const subtitleSpeedRef = useRef(50)

  // LLM 텍스트 프로그레시브 표시
  useEffect(() => {
    if (!llmText) return

    if (llmText !== displayedLlmText && subtitleProgress === 0) {
      setDisplayedLlmText("")
    }

    if (subtitleProgress < llmText.length) {
      const timer = setTimeout(() => {
        let nextBreak = llmText.indexOf(". ", subtitleProgress)
        if (nextBreak === -1) nextBreak = llmText.indexOf(", ", subtitleProgress)
        if (nextBreak === -1) nextBreak = llmText.indexOf("? ", subtitleProgress)
        if (nextBreak === -1) nextBreak = llmText.indexOf("! ", subtitleProgress)

        const endIndex = nextBreak !== -1 ? nextBreak + 2 : llmText.length

        setDisplayedLlmText(llmText.substring(0, endIndex))
        setSubtitleProgress(endIndex)

        const chunkLength = endIndex - subtitleProgress
        const adjustedDelay = Math.max(200, Math.min(800, chunkLength * subtitleSpeedRef.current))

        subtitleSpeedRef.current = Math.max(30, subtitleSpeedRef.current * 0.95)
      }, subtitleSpeedRef.current)

      return () => clearTimeout(timer)
    }
  }, [llmText, displayedLlmText, subtitleProgress])

  useEffect(() => {
    if (llmText) {
      setSubtitleProgress(0)
      subtitleSpeedRef.current = 50
    }
  }, [llmText])


  // Health check - only for real mode
  const checkHealth = async () => {
    if (isSimulationMode === true) {
      console.log("🎭 시뮬레이션 모드 - health check 건너뜀")
      return // Skip health check in simulation mode
    }

    console.log("🔍 Health check 시작...")
    try {
      const response = await fetch("/health")
      console.log("📡 Health check 응답 상태:", response.status)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      console.log("📊 Health check 데이터:", data)
      setHealthStatus(data)
      console.log("✅ Health status 업데이트 완료:", data)
    } catch (err) {
      console.error("❌ Health check 실패:", err)
      setHealthStatus({ stt: false, llm: false, tts: false })
    }
  }

  // Only check health in real mode
  useEffect(() => {
    console.log("🔄 useEffect 실행 - isSimulationMode:", isSimulationMode)

    if (isSimulationMode === false) {
      console.log("🔗 실제 서버 모드 - health check 시작")
      checkHealth()
      const interval = setInterval(() => {
        console.log("⏰ 정기 health check 실행")
        checkHealth()
      }, 10000)
      return () => {
        console.log("🛑 Health check interval 정리")
        clearInterval(interval)
      }
    } else {
      console.log("🎭 시뮬레이션 모드 또는 모드 미선택 - health check 건너뜀")
    }
  }, [isSimulationMode])

  // Add this useEffect to monitor healthStatus changes
  useEffect(() => {
    console.log("🏥 Health status 변경됨:", healthStatus)
  }, [healthStatus])

  // Stop TTS
  const stopTTS = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (ttsTimeoutRef.current) {
      clearTimeout(ttsTimeoutRef.current)
      ttsTimeoutRef.current = null
    }
    setIsTTSPlaying(false)
    setTtsText("")
  }

  // Select mode and go to start screen
  const selectMode = (simulationMode: boolean) => {
    stopTTS();                   // ← 이 줄을 추가
    setIsSimulationMode(simulationMode)
    setCurrentScreen("start")
    setTtsDisplayText("화면을 눌러 서비스를 시작해주세요")
  }


// startKiosk 에서도 같은 문장만
const startKiosk = async () => {
  stopTTS();
  setCurrentScreen("main");
  // 오직 이 한 번만 하드코딩
  const welcome = "병원 안내 키오스크입니다. 원하시는 서비스를 선택하거나 음성으로 말씀해주세요.";
  setTtsDisplayText(welcome);
  await playTTS(welcome);
};


  // // Play TTS
  // const playTTS = async (text: string) => {
  //   stopTTS() // 기존 TTS 중지

  //   setIsTTSPlaying(true)
  //   setTtsText("🔊 음성 안내 중...")

  //   if (isSimulationMode) {
  //     ttsTimeoutRef.current = setTimeout(() => {
  //       setTtsText("✅ 음성 안내 완료")
  //       setIsTTSPlaying(false)
  //       // 3초 후 완료 메시지도 사라지게
  //       setTimeout(() => setTtsText(""), 3000)
  //     }, 2000)
  //     return
  //   }

  //   try {
  //     const response = await fetch("/speak", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ text }),
  //     })

  //     if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)

  //     const data = await response.json()

  //     if (data.simulated) {
  //       ttsTimeoutRef.current = setTimeout(() => {
  //         setTtsText("✅ 음성 안내 완료")
  //         setIsTTSPlaying(false)
  //         setTimeout(() => setTtsText(""), 3000)
  //       }, 2000)
  //       return
  //     }

  //     if (data.audio_path && audioRef.current) {
  //   try {
  //     // ✅ 수정된 부분: 쿼리 문자열 제거, 직접 경로 사용
  //     audioRef.current.src = data.audio_path
  //     audioRef.current.load()

  //     const playPromise = audioRef.current.play()
  //     if (playPromise !== undefined) {
  //       playPromise.catch((err) => {
  //         console.error("Audio playback failed:", err)
  //         setTtsText("✅ 음성 안내 완료")
  //         setIsTTSPlaying(false)
  //         setTimeout(() => setTtsText(""), 3000)
  //       })
  //     }

  //     audioRef.current.onended = () => {
  //       setTtsText("✅ 음성 안내 완료")
  //       setIsTTSPlaying(false)
  //       setTimeout(() => setTtsText(""), 3000)
  //     }
  //   } catch (audioError) {
  //     console.error("Audio error:", audioError)
  //     setTtsText("✅ 음성 안내 완료")
  //     setIsTTSPlaying(false)
  //     setTimeout(() => setTtsText(""), 3000)
  //   }
  //  }

// const playTTS = async (text: string) => {
//   stopTTS() // 기존 TTS 중지

//   setIsTTSPlaying(true)
//   setTtsText("🔊 음성 안내 중...")

//   if (isSimulationMode) {
//     // ... 시뮬레이션 모드 처리 ...
//     return
//   }

//   try {
//     const response = await fetch("/speak", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ text }),
//     })

//     if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)

//     const contentType = response.headers.get("Content-Type")
//     if (!contentType?.includes("audio")) {
//       throw new Error(`Unexpected Content-Type: ${contentType}`)
//     }

//     const blob = await response.blob()
//     if (blob.size === 0) throw new Error("Received empty audio blob")

//     const url = URL.createObjectURL(blob)
//     if (audioRef.current) {
//       audioRef.current.src = url
//       audioRef.current.load()
//       const playPromise = audioRef.current.play()
//       if (playPromise) {
//         playPromise.catch((err) => console.error("Audio playback failed:", err))
//       }
//     }
//   } catch (error) {
//     console.error("TTS 요청 오류:", error)
//     setTtsText("⚠️ 음성 안내 실패")
//     setIsTTSPlaying(false)
//     // 3초 뒤에 표시 메시지 지우기
//     setTimeout(() => setTtsText(""), 3000)
//   }
// }  // ← 이 중괄호가 빠져 있으면 EOF 에러 발생

  
  // // 예: playTTS 함수 내에서
  // const playTTS = async (text: string) => {
  //   try {
  //     // 1) TTS 텍스트 전송
  //     const ttsRes = await fetch("/speak", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ text }),
  //     });
  //     if (!ttsRes.ok) throw new Error(`${ttsRes.status}`);

  //     const { audio_path } = await ttsRes.json() as { audio_path: string };
  //     console.log("▶ 받은 audio_path:", audio_path);

  //     // 2) <audio> 태그로 재생
  //     const audio = new Audio(audio_path);
  //     audio.onended = () => console.log("▶ TTS 재생 완료");
  //     audio.play().catch((e) => console.error("❌ Audio playback failed:", e));
  //   } catch (e) {
  //     console.error("❌ playTTS 에러:", e);
  //   }
  // };

const playTTS = async (text: string) => {
  try {
    // 1) POST /speak
    const res = await fetch(`${window.location.origin}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    // 2) if it wasn’t a 2xx, bail out early
    if (!res.ok) {
      console.error("❌ TTS 요청 실패:", res.status);
      // optionally, dump the body so you can see what StaticFiles is sending you back:
      const body = await res.text();
      console.error("▶ 서버 응답 바디:", body);
      return;
    }

    // 3) only now parse JSON
    const data: { audio_path: string } = await res.json();
    console.log("▶ 받은 audio_path:", data.audio_path);

    // 4) play it
    const audioUrl = `${window.location.origin}${data.audio_path}`;
    const audio = new Audio(audioUrl);
    audio.onended = () => console.log("▶ TTS 재생 완료");
    await audio.play();

  } catch (err) {
    console.error("❌ playTTS 에러:", err);
  }
};




 // Reset to main screen
  const resetToMain = () => {
    stopTTS() // TTS 중지

    setCurrentScreen("main")
    setCurrentService(null)
    setCurrentStep(null)
    setStatus("대기 중")
    setIsLoading(false)
    setSttText("")
    setLlmText("")
    setTtsText("")
    setDisplayedLlmText("")
    setErrorCount(0)
    setRetryCount(0)
    setUserInfo({ name: "", phone: "", address: "", symptom: "" })
    setLookupInfo({ name: "", phone: "" })
    setPredictedDept("")
    setReceptionResult(null)
    setTtsDisplayText("원하시는 서비스를 선택하거나 음성으로 말씀해주세요.")
  }

  // Go back to services
  const goBackToServices = () => {
    stopTTS() // TTS 중지

    setCurrentScreen("main")
    setCurrentService(null)
    setCurrentStep(null)
    setTtsDisplayText("원하시는 서비스를 선택하거나 음성으로 말씀해주세요.")
  }
  
// Handle service selection
const handleServiceSelection = async (service: ServiceType) => {
  stopTTS()
  setCurrentService(service)
  setCurrentScreen("service")

  // 기존 텍스트 초기화
  setSttText("")
  setLlmText("")
  setDisplayedLlmText("")
  setSubtitleProgress(0)

  // ① prompt와 nextStep 정의
  let prompt = ""
  let nextStep: ReceptionStep | LookupStep | DirectionStep | null = null

  switch (service) {
    case "reception":
      prompt = "접수"
      nextStep = "name"
      break
    case "lookup":
      prompt = "접수 내역 확인"
      nextStep = "lookupName"
      break
    case "direction":
      prompt = "길찾기"
      nextStep = "direction"
      break
  }
  setCurrentStep(nextStep)

  // ② LLM 호출
  const aiResponse = await sendToLLM(prompt, "service_selection")

  // ③ 화면 · 자막 · TTS 동시 반영
  setLlmText(aiResponse)
  setTtsDisplayText(aiResponse)
  await playTTS(aiResponse)
}




const handleUserInput = async (inputText: string) => {
  stopTTS();

  // 1) 아직 서비스 선택 전이면, 음성으로 “접수”·“접수 내역”·“길찾기” 중 하나를 인식
  if (!currentService && currentScreen === "main") {
    const txt = inputText.replace(/\s+/g, "");
    if (txt.includes("접수내역") || txt.includes("내역")) {
      return handleServiceSelection("lookup");
    }
    if (txt.includes("접수")) {
      return handleServiceSelection("reception");
    }
    if (txt.includes("길찾기") || txt.includes("길찾")) {
      return handleServiceSelection("direction");
    }
    // 인식 실패 시 재안내
    const retryMsg = "‘접수’, ‘접수 내역 확인’ 또는 ‘길찾기’ 중 하나를 말씀해주세요.";
    setTtsDisplayText(retryMsg);
    await playTTS(retryMsg);
    return;
  }

  // 2) 그 외 – 이미 서비스가 선택된 상태라면 기존 흐름대로 LLM 호출
  if (currentService) {
    const aiResponse = await sendToLLM(inputText, currentService);
    setLlmText(aiResponse);
    setTtsDisplayText(aiResponse);
    await playTTS(aiResponse);
  }
};


  // Reception flow handler
  const handleReceptionFlow = async (inputText: string) => {
    switch (currentStep) {
      case "name":
        setUserInfo((prev) => ({ ...prev, name: inputText }))
        setTtsDisplayText(`${inputText}님, 맞습니까?`)
        await playTTS(`${inputText}님, 맞습니까?`)
        setCurrentStep("confirmName")
        break

      case "confirmName":
        const nameConfirm = await classifyYesOrNo(inputText)
        if (nameConfirm === "긍정") {
          setRetryCount(0)
          setTtsDisplayText("전화번호를 말씀해주세요.")
          await playTTS("전화번호를 말씀해주세요.")
          setCurrentStep("phone")
        } else if (nameConfirm === "부정") {
          setRetryCount((prev) => prev + 1)
          if (retryCount >= 2) {
            await handleError("입력 오류가 반복되었습니다. 직원을 호출하겠습니다.")
            return
          }
          setTtsDisplayText("다시 성함을 말씀해주세요.")
          await playTTS("다시 성함을 말씀해주세요.")
          setCurrentStep("name")
        } else {
          setTtsDisplayText("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
          await playTTS("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
        }
        break

      case "phone":
        setUserInfo((prev) => ({ ...prev, phone: inputText }))
        setTtsDisplayText(`${inputText} 번호가 맞습니까?`)
        await playTTS(`${inputText} 번호가 맞습니까?`)
        setCurrentStep("confirmPhone")
        break

      case "confirmPhone":
        const phoneConfirm = await classifyYesOrNo(inputText)
        if (phoneConfirm === "긍정") {
          setRetryCount(0)
          setTtsDisplayText("주소를 말씀해주세요.")
          await playTTS("주소를 말씀해주세요.")
          setCurrentStep("address")
        } else if (phoneConfirm === "부정") {
          setRetryCount((prev) => prev + 1)
          if (retryCount >= 2) {
            await handleError("입력 오류가 반복되었습니다. 직원을 호출하겠습니다.")
            return
          }
          setTtsDisplayText("다시 전화번호를 말씀해주세요.")
          await playTTS("다시 전화번호를 말씀해주세요.")
          setCurrentStep("phone")
        } else {
          setTtsDisplayText("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
          await playTTS("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
        }
        break

      case "address":
        setUserInfo((prev) => ({ ...prev, address: inputText }))
        setTtsDisplayText(`${inputText} 주소가 맞습니까?`)
        await playTTS(`${inputText} 주소가 맞습니까?`)
        setCurrentStep("confirmAddress")
        break

      case "confirmAddress":
        const addressConfirm = await classifyYesOrNo(inputText)
        if (addressConfirm === "긍정") {
          setRetryCount(0)
          setTtsDisplayText("불편하신 증상을 말씀해주세요.")
          await playTTS("불편하신 증상을 말씀해주세요.")
          setCurrentStep("symptom")
        } else if (addressConfirm === "부정") {
          setRetryCount((prev) => prev + 1)
          if (retryCount >= 2) {
            await handleError("입력 오류가 반복되었습니다. 직원을 호출하겠습니다.")
            return
          }
          setTtsDisplayText("다시 주소를 말씀해주세요.")
          await playTTS("다시 주소를 말씀해주세요.")
          setCurrentStep("address")
        } else {
          setTtsDisplayText("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
          await playTTS("잘 이해하지 못했습니다. 맞으면 '네', 아니면 '아니오'라고 말씀해주세요.")
        }
        break

      case "symptom":
        setUserInfo((prev) => ({ ...prev, symptom: inputText }))
        // LLM으로 진료과 추천 요청
        const triageResponse = await sendToLLM(`증상: ${inputText}`, "triage_step1")
        const deptMatch = triageResponse.match(/([가-힣]+과)/)
        const dept = deptMatch ? deptMatch[1] : "해당 진료과"
        setPredictedDept(dept)

        const responseText = `${triageResponse}\n\n이 진료과로 접수해 드릴까요?`
        setTtsDisplayText(responseText)
        await playTTS(responseText)
        setCurrentStep("confirmTriage")
        break

      case "confirmTriage":
        const triageConfirm = await classifyYesOrNo(inputText)
        if (triageConfirm === "긍정") {
          // 접수 완료 처리
          const receptionInfo: ReceptionInfo = {
            dept: predictedDept,
            date: "2025년 7월 29일",
            time: "오전 10시",
          }
          setReceptionResult(receptionInfo)

          const completionResponse = await sendToLLM(
            `${userInfo.name}님 ${predictedDept}로 접수해 주세요`,
            "triage_step2",
          )
          setTtsDisplayText(completionResponse)
          await playTTS(completionResponse)
          setCurrentStep("finish")
        } else if (triageConfirm === "부정") {
          setTtsDisplayText("접수를 원하지 않으시면 처음부터 다시 진행해 주세요.")
          await playTTS("접수를 원하지 않으시면 처음부터 다시 진행해 주세요.")
          resetToMain()
        } else {
          setTtsDisplayText("잘 이해하지 못했습니다. 접수 원하시면 '네'라고 말씀해주세요.")
          await playTTS("잘 이해하지 못했습니다. 접수 원하시면 '네'라고 말씀해주세요.")
        }
        break

      case "finish":
        // 추가 질문 처리
        const followUpResponse = await sendToLLM(inputText, "triage_step2")
        setTtsDisplayText(followUpResponse)
        await playTTS(followUpResponse)
        break
    }
  }

  // Lookup flow handler
  const handleLookupFlow = async (inputText: string) => {
    switch (currentStep) {
      case "lookupName":
        setLookupInfo((prev) => ({ ...prev, name: inputText }))
        setTtsDisplayText(`${inputText}님, 전화번호를 말씀해주세요.`)
        await playTTS(`${inputText}님, 전화번호를 말씀해주세요.`)
        setCurrentStep("lookupPhone")
        break

      case "lookupPhone":
        setLookupInfo((prev) => ({ ...prev, phone: inputText }))
        // 접수 내역 조회 시뮬레이션
        const lookupResponse = await sendToLLM(`이름: ${lookupInfo.name}, 전화번호: ${inputText}`, "lookup")
        setTtsDisplayText(lookupResponse)
        await playTTS(lookupResponse)
        setCurrentStep("showResult")
        break

      case "showResult":
        // 추가 질문이나 다른 서비스 요청 처리
        resetToMain()
        break
    }
  }

  // Direction flow handler
  const handleDirectionFlow = async (inputText: string) => {
    switch (currentStep) {
      case "direction":
        const directionResponse = await sendToLLM(`${inputText} 어디에 있나요?`, "direction")
        setTtsDisplayText(directionResponse)
        await playTTS(directionResponse)
        setCurrentStep("showDirection")
        break

      case "showDirection":
        // 추가 길찾기 요청이나 다른 서비스 요청 처리
        resetToMain()
        break
    }
  }

  // Classify yes or no
  const classifyYesOrNo = async (text: string): Promise<string> => {
    // 시뮬레이션 모드에서는 간단한 키워드 매칭
    if (isSimulationMode) {
      const positiveWords = ["네", "예", "맞아", "맞습니다", "응", "좋아", "해줘", "그래"]
      const negativeWords = ["아니", "아니오", "틀려", "틀렸어", "싫어", "안돼"]

      if (positiveWords.some((word) => text.includes(word))) return "긍정"
      if (negativeWords.some((word) => text.includes(word))) return "부정"
      return "모르겠음"
    }

    // 실제 LLM 호출 (백엔드 연결 시)
    try {
      const response = await sendToLLM(text, "classify")
      return response.includes("긍정") ? "긍정" : response.includes("부정") ? "부정" : "모르겠음"
    } catch (error) {
      return "모르겠음"
    }
  }

  // Simulate LLM response
  const simulateLLMResponse = async (input: string, type: string): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, 2000))

    switch (type) {
      case "triage_step1":
        if (input.includes("머리") || input.includes("두통")) {
          return "그런 증상은 신경과가 적절합니다."
        } else if (input.includes("배") || input.includes("복통")) {
          return "내과를 추천드립니다."
        } else if (input.includes("다리") || input.includes("무릎")) {
          return "정형외과를 추천드립니다."
        } else {
          return "내과를 추천드립니다."
        }

      case "triage_step2":
        return `접수가 완료되었습니다. ${predictedDept}는 본관 3층에 위치해 있으며, 예상 대기시간은 약 20분입니다. 대기번호는 5번입니다.`

      case "lookup":
        return `${lookupInfo.name}님은 2025년 7월 29일 오전 10시에 내과로 접수되어 있습니다. 현재 대기번호는 3번이며, 예상 대기시간은 약 15분입니다.`

      case "direction":
        if (input.includes("내과")) {
          return "내과는 본관 2층에 위치해 있습니다. 엘리베이터를 타고 2층에서 내려서 오른쪽으로 가시면 됩니다."
        } else if (input.includes("수납")) {
          return "수납창구는 1층 로비 왼쪽에 있습니다."
        } else if (input.includes("주차")) {
          return "주차장은 지하 1층과 2층에 있습니다. 지하 주차장 입구는 병원 뒤편에 있습니다."
        } else {
          return "죄송합니다. 구체적인 위치를 말씀해주시면 더 정확한 안내를 드릴 수 있습니다."
        }

      default:
        return "죄송합니다. 다시 한 번 말씀해주세요."
    }
  }

    // ────────────────────────────────────────────────────
// 컴포넌트 바디 안, 다른 훅들(useState 등) 아래에 위치시킵니다.
// ────────────────────────────────────────────────────
const sendToLLM = async (text: string, type: string): Promise<string> => {
  setIsLoading(true)
  setStatus("AI 처리 중...")
  try {
    const ws = new WebSocket(`ws://localhost:8000/ws/kiosk`)
    wsRef.current = ws

    return await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close()
        resolve(simulateLLMResponse(text, type))
      }, 3000)

      ws.onopen = () => {
        clearTimeout(timeout)
        setStatus("AI 응답 생성 중...")
        ws.send(JSON.stringify({ text, type }))
      }

      ws.onmessage = (event) => {
        const msg: WebSocketMessage = JSON.parse(event.data)
        if (msg.stage === "llm" && msg.text) {
          clearTimeout(timeout)
          setLlmText(msg.text)
          setTtsDisplayText(msg.text)
          resolve(msg.text)
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        resolve(simulateLLMResponse(text, type))
      }
    })
  } catch (e) {
    console.error("LLM processing error:", e)
    return simulateLLMResponse(text, type)
  } finally {
    setIsLoading(false)
  }
}
// ────────────────────────────────────────────────────

     

  // Handle errors
  const handleError = async (errorMessage: string) => {
    setErrorCount((prev) => prev + 1)

    if (errorCount >= 2) {
      setTtsDisplayText("죄송합니다. 직원을 호출하겠습니다. 잠시만 기다려주세요.")
      setStatus("직원 호출 중...")
      await playTTS("죄송합니다. 직원을 호출하겠습니다. 잠시만 기다려주세요.")

      setTimeout(() => {
        setStatus("직원이 곧 도착합니다")
        setErrorCount(0)
        resetToMain()
      }, 3000)
    } else {
      const retryMessages = [
        "죄송합니다. 다시 한 번 말씀해주세요.",
        "잘 들리지 않았습니다. 다시 말씀해주시거나 화면의 버튼을 눌러주세요.",
      ]
      const message = retryMessages[errorCount - 1]
      setTtsDisplayText(message)
      await playTTS(message)
    }

    setIsLoading(false)
  }

  // Start recording
  const startRecording = async () => {
    console.log("startRecording 함수 호출됨")
    stopTTS() // TTS 중지

    try {
      // 먼저 상태를 바꿔서 UI 업데이트
      setIsRecording(true)
      setStatus("마이크 권한 요청 중...")

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("getUserMedia not supported")
        await handleError("이 브라우저에서는 음성 녹음이 지원되지 않습니다")
        setIsRecording(false)
        return
      }

      console.log("마이크 권한 요청 중...")
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      })

      console.log("마이크 권한 획득 성공")

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4",
      })

      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        console.log("Audio data available:", event.data.size)
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped")
        const mimeType = mediaRecorder.mimeType || "audio/webm"
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        const audioFile = new File([audioBlob], "recording.wav", { type: "audio/wav" })

        uploadAndProcessAudio(audioFile)
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event)
        handleError("녹음 중 오류가 발생했습니다")
        setIsRecording(false)
        stream.getTracks().forEach((track) => track.stop())
      }

      console.log("녹음 시작")
      mediaRecorder.start(1000)
      setStatus("🎤 녹음 중... 말씀해주세요")

      // 10초 후 자동 중지 (백업용)
      recordingTimeoutRef.current = setTimeout(() => {
        console.log("10초 자동 중지")
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop()
          setIsRecording(false)
        }
      }, 10000)
    } catch (err) {
      console.error("Recording error:", err)
      setIsRecording(false)

      if (err.name === "NotAllowedError") {
        await handleError("마이크 사용 권한을 허용해주세요")
      } else if (err.name === "NotFoundError") {
        await handleError("마이크를 찾을 수 없습니다")
      } else {
        await handleError("음성 녹음을 시작할 수 없습니다")
      }
    }
  }
  

  // Stop recording
  const stopRecording = () => {
    console.log("stopRecording 함수 호출됨")

    if (mediaRecorderRef.current && isRecording) {
      console.log("녹음 중지 중...")
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      setStatus("음성 처리 중...")

      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
      }
    } else {
      console.log("녹음 중이 아니거나 MediaRecorder가 없음")
    }
  }

  // // Upload and process audio - 수정된 부분
  // const uploadAndProcessAudio = async (audioFile: File) => {
  //   setIsLoading(true)
  //   setStatus("음성 처리 중...")

  //   try {
  //     const formData = new FormData()
  //     formData.append("file", audioFile)

  //     const response = await fetch("/upload-audio", {
  //       method: "POST",
  //       body: formData,
  //     })

  //     if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)

  //     const data = await response.json()

  //     if (isSimulationMode || data.simulated) {
  //       await simulateSTTProcessing()
  //       return
  //     }

  //     // WebSocket을 통한 STT 처리
  //     const ws = new WebSocket(`ws://localhost:8000/ws/kiosk`)
  //     wsRef.current = ws

  //     const connectionTimeout = setTimeout(() => {
  //       if (ws.readyState !== WebSocket.OPEN) {
  //         ws.close()
  //         simulateSTTProcessing()
  //       }
  //     }, 3000)

  //     ws.onopen = () => {
  //       clearTimeout(connectionTimeout)
  //       setStatus("음성 인식 중...")
  //       // 확장자 정보도 함께 전송
  //       ws.send(
  //         JSON.stringify({
  //           file_id: data.file_id,
  //           extension: data.extension,
  //         }),
  //       )
  //     }

  //     ws.onmessage = (event) => {
  //       const msg: WebSocketMessage = JSON.parse(event.data)
  //       if (msg.stage === "stt" && msg.text) {
  //         handleUserInput(msg.text)
  //       }
  //     }

  //     ws.onerror = () => {
  //       clearTimeout(connectionTimeout)
  //       simulateSTTProcessing()
  //     }
  //   } catch (err) {
  //     console.error("Upload error:", err)
  //     await handleError("음성 처리 중 오류가 발생했습니다")
  //   } finally {
  //     setIsLoading(false)
  //   }
  // }

// Upload and process audio - 디버깅 로그 추가
const uploadAndProcessAudio = async (audioFile: File) => {
  setIsLoading(true)
  setStatus("음성 처리 중...")

  try {
    // 1) audioFile 객체 확인
    console.log("▶ [uploadAndProcessAudio] audioFile:", audioFile)

    // 2) FormData에 잘 담겼는지 확인
    const formData = new FormData()
    formData.append("file", audioFile)
    for (const [key, value] of formData.entries()) {
      console.log("▶ [uploadAndProcessAudio] formData entry:", key, value)
    }

    // 3) fetch 호출 전·후 로깅
    console.log("🚀 [uploadAndProcessAudio] fetch 시작:", "/upload-audio")
    const response = await fetch("/upload-audio", {
      method: "POST",
      body: formData,
    })
    console.log("✅ [uploadAndProcessAudio] fetch 응답 상태:", response.status)

    // 만약 JSON이 아니라면 text()로 찍어보기
    const text = await response.text()
    console.log("📨 [uploadAndProcessAudio] response text:", text)

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`)
    }

    // JSON으로 파싱
    const data = JSON.parse(text)
    console.log("📦 [uploadAndProcessAudio] response JSON:", data)

    if (isSimulationMode || data.simulated) {
      await simulateSTTProcessing()
      return
    }

    // WebSocket을 통한 STT 처리 (기존 로직)
    const ws = new WebSocket(`ws://localhost:8000/ws/kiosk`)
    wsRef.current = ws

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close()
        simulateSTTProcessing()
      }
    }, 3000)

    ws.onopen = () => {
      clearTimeout(connectionTimeout)
      setStatus("음성 인식 중...")
      ws.send(
        JSON.stringify({
          file_id: data.file_id,
          extension: data.extension,
        }),
      )
    }

    ws.onmessage = (event) => {
      const msg: WebSocketMessage = JSON.parse(event.data)
      if (msg.stage === "stt" && msg.text) {
        handleUserInput(msg.text)
      }
    }

    ws.onerror = () => {
      clearTimeout(connectionTimeout)
      simulateSTTProcessing()
    }
  } catch (err) {
    console.error("❌ [uploadAndProcessAudio] Upload error:", err)
    await handleError("음성 처리 중 오류가 발생했습니다")
  } finally {
    setIsLoading(false)
  }
}


  // Simulate STT processing
  const simulateSTTProcessing = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const sampleTexts = [
      "김철수",
      "네",
      "010-1234-5678",
      "서울시 강남구",
      "머리가 아파요",
      "접수 문의드립니다",
      "내과 어디에 있나요",
    ]

    const randomText = sampleTexts[Math.floor(Math.random() * sampleTexts.length)]
    setSttText(randomText)
    await handleUserInput(randomText)
  }

 

  // Go back to start screen
  const goBackToStart = () => {
    stopTTS()
    setCurrentScreen("start")
    setCurrentService(null)
    setCurrentStep(null)
    setStatus("대기 중")
    setIsLoading(false)
    setSttText("")
    setLlmText("")
    setTtsText("")
    setDisplayedLlmText("")
    setErrorCount(0)
    setRetryCount(0)
    setUserInfo({ name: "", phone: "", address: "", symptom: "" })
    setLookupInfo({ name: "", phone: "" })
    setPredictedDept("")
    setReceptionResult(null)
    setTtsDisplayText("화면을 눌러 서비스를 시작해주세요")
  }

  // Reset to mode selection (complete reset)
  const resetToModeSelection = () => {
    stopTTS()
    setCurrentScreen("modeSelect")
    setIsSimulationMode(null)
    setCurrentService(null)
    setCurrentStep(null)
    setStatus("대기 중")
    setIsLoading(false)
    setSttText("")
    setLlmText("")
    setTtsText("")
    setDisplayedLlmText("")
    setErrorCount(0)
    setRetryCount(0)
    setUserInfo({ name: "", phone: "", address: "", symptom: "" })
    setLookupInfo({ name: "", phone: "" })
    setPredictedDept("")
    setReceptionResult(null)
    setTtsDisplayText("원하시는 모드를 선택해주세요")
  }

  // Get current step description
  const getCurrentStepDescription = () => {
    if (!currentService || !currentStep) return ""

    const stepDescriptions = {
      reception: {
        name: "성함 입력",
        confirmName: "성함 확인",
        phone: "전화번호 입력",
        confirmPhone: "전화번호 확인",
        address: "주소 입력",
        confirmAddress: "주소 확인",
        symptom: "증상 입력",
        confirmTriage: "진료과 확인",
        finish: "접수 완료",
      },
      lookup: {
        lookupName: "성함 입력",
        lookupPhone: "전화번호 입력",
        showResult: "접수 내역 확인",
      },
      direction: {
        direction: "목적지 입력",
        showDirection: "길안내 완료",
      },
    }

    return (
      stepDescriptions[currentService]?.[currentStep as keyof (typeof stepDescriptions)[typeof currentService]] || ""
    )
  }
  

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-green-100 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="floating-orb floating-orb-1"></div>
        <div className="floating-orb floating-orb-2"></div>
        <div className="floating-orb floating-orb-3"></div>
      </div>

      <div className="relative z-10 h-screen flex flex-col">
        {/* Header - Fixed */}
        <div className="bg-white/90 backdrop-blur-md border-b border-green-200/50 p-3 sm:p-4">
          <div className="text-center">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800 flex items-center justify-center gap-2">
              <div className="w-6 h-6 sm:w-8 sm:h-8 bg-green-600 rounded flex items-center justify-center">
                <Plus className="w-4 h-4 sm:w-6 sm:h-6 text-white stroke-[3]" />
              </div>
              병원 안내 키오스크
            </h1>
            {currentService && currentStep && (
              <div className="mt-1 text-sm sm:text-base text-green-700 bg-green-50 px-3 py-1 rounded-md inline-block">
                {getCurrentStepDescription()}
              </div>
            )}
            {isSimulationMode === true && (
              <div className="mt-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md inline-block">
                🎭 시뮬레이션 모드
              </div>
            )}
            {isSimulationMode === false && (
              <div className="mt-1 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-md inline-block">
                🔗 실제 서버 모드
              </div>
            )}
          </div>
        </div>

        {/* Main Content - Flexible */}
        <div className="flex-1 flex flex-col p-3 sm:p-4 space-y-3 sm:space-y-4 overflow-y-auto">
          {/* Mode Selection Screen - 첫 번째 화면 */}
          {currentScreen === "modeSelect" && (
            <div className="flex-1 flex items-center justify-center">
              <Card className="glass-card w-full max-w-lg hover-lift">
                <CardContent className="p-6 sm:p-8">
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce-gentle">
                      <Settings className="w-8 h-8 sm:w-10 sm:h-10 text-white stroke-[3]" />
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">모드 선택</h2>
                    <p className="text-base sm:text-lg text-gray-600">원하시는 모드를 선택해주세요</p>
                  </div>

                  <div className="space-y-4">
                    {/* Simulation Mode */}
                    <Button
                      onClick={() => selectMode(true)}
                      size="lg"
                      className="kiosk-button w-full h-16 sm:h-20 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <div className="flex items-center justify-start w-full">
                        <Zap className="w-6 h-6 sm:w-8 sm:h-8 mr-4 flex-shrink-0" />
                        <div className="text-left">
                          <div className="text-lg sm:text-xl font-bold">🎭 시뮬레이션 모드</div>
                          <div className="text-sm sm:text-base opacity-90">데모 및 테스트용 (서버 연결 불필요)</div>
                        </div>
                      </div>
                    </Button>

                    {/* Real Server Mode */}
                    <Button
                      onClick={() => selectMode(false)}
                      size="lg"
                      className="kiosk-button w-full h-16 sm:h-20 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <div className="flex items-center justify-start w-full">
                        <Settings className="w-6 h-6 sm:w-8 sm:h-8 mr-4 flex-shrink-0" />
                        <div className="text-left">
                          <div className="text-lg sm:text-xl font-bold">🔗 실제 서버 모드</div>
                          <div className="text-sm sm:text-base opacity-90">실제 AI 서버와 연동 (운영용)</div>
                        </div>
                      </div>
                    </Button>
                  </div>

                  <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                    <h3 className="font-semibold text-gray-800 mb-2">모드 설명</h3>
                    <div className="text-sm text-gray-600 space-y-2">
                      <p>
                        <strong>시뮬레이션 모드:</strong> 미리 정의된 응답으로 키오스크 기능을 체험할 수 있습니다.
                      </p>
                      <p>
                        <strong>실제 서버 모드:</strong> STT, LLM, TTS 서버와 실시간으로 연동하여 실제 음성 인식과 AI
                        응답을 제공합니다.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Start Screen - 두 번째 화면 */}
          {currentScreen === "start" && (
            <div className="flex-1 flex items-center justify-center">
              <Card className="glass-card w-full max-w-md hover-lift">
                <CardContent className="p-6 sm:p-8 text-center">
                  <div className="mb-6">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce-gentle">
                      <Cross className="w-8 h-8 sm:w-10 sm:h-10 text-white stroke-[3]" />
                    </div>
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-700 mb-2">
                      {isSimulationMode ? "시뮬레이션 모드" : "실제 서버 모드"}
                    </h2>
                    <p className="text-base sm:text-lg text-gray-600">화면을 눌러 서비스를 시작해주세요</p>
                  </div>
                  <Button
                    onClick={startKiosk}
                    size="lg"
                    className="kiosk-button w-full bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 py-4 sm:py-6 text-lg sm:text-xl font-semibold"
                  >
                    시작하기
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Main Screen - Service Selection */}
          {currentScreen === "main" && (
            <>
              {/* TTS Display Area */}
              <Card className="glass-card">
                <CardContent className="p-4 sm:p-6">
                  <div className="bg-gradient-to-r from-green-100 to-green-200 p-4 sm:p-6 rounded-2xl border border-green-300/30">
                    <div className="flex items-start gap-3">
                      <Volume2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 mt-1 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-base sm:text-lg lg:text-xl font-medium text-gray-800 leading-relaxed mb-2">
                          {ttsDisplayText}
                        </p>
                        <div className="flex items-center justify-between">
                          {ttsText && (
                            <div className="text-sm sm:text-base text-green-700 flex items-center gap-2">{ttsText}</div>
                          )}
                          <div className="flex items-center gap-2">
                            {ttsDisplayText && !isTTSPlaying && (
                              <Button
                                onClick={() => {
                                  stopTTS()  
                                  playTTS(ttsDisplayText)
                                }}
                                size="sm"
                                variant="outline"
                                className="text-xs px-2 py-1 border-green-300 text-green-600 hover:bg-green-50 bg-transparent"
                              >
                                <Volume2 className="w-3 h-3 mr-1" />
                                다시 듣기
                              </Button>
                            )}
                            {isTTSPlaying && (
                              <Button
                                onClick={stopTTS}
                                size="sm"
                                variant="outline"
                                className="text-xs px-2 py-1 border-red-300 text-red-600 hover:bg-red-50 bg-transparent"
                              >
                                <VolumeX className="w-3 h-3 mr-1" />
                                음성 중지
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service Selection Buttons */}
              <Card className="glass-card">
                <CardContent className="p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 text-center">이용 가능한 서비스</h3>
                  <div className="grid grid-cols-1 gap-3 sm:gap-4">
                    <Button
                      onClick={() => {
                        stopTTS()  
                        handleServiceSelection("reception")}}
                      disabled={isLoading}
                      size="lg"
                      className="kiosk-button h-14 sm:h-16 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <FileText className="w-5 h-5 sm:w-6 sm:h-6 mr-3" />
                      <div className="text-left">
                        <div className="text-base sm:text-lg font-semibold">접수</div>
                        <div className="text-xs sm:text-sm opacity-90">진료 접수 및 예약</div>
                      </div>
                    </Button>

                    <Button
                      onClick={() => {
                        stopTTS()  
                        handleServiceSelection("lookup")}}
                      disabled={isLoading}
                      size="lg"
                      className="kiosk-button h-14 sm:h-16 bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-700 hover:to-teal-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <ClipboardList className="w-5 h-5 sm:w-6 sm:h-6 mr-3" />
                      <div className="text-left">
                        <div className="text-base sm:text-lg font-semibold">접수내역 확인</div>
                        <div className="text-xs sm:text-sm opacity-90">예약 현황 및 대기시간</div>
                      </div>
                    </Button>

                    <Button
                      onClick={() =>
                        {stopTTS()  
                           handleServiceSelection("direction")}}
                      disabled={isLoading}
                      size="lg"
                      className="kiosk-button h-14 sm:h-16 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                    >
                      <MapPin className="w-5 h-5 sm:w-6 sm:h-6 mr-3" />
                      <div className="text-left">
                        <div className="text-base sm:text-lg font-semibold">길찾기</div>
                        <div className="text-xs sm:text-sm opacity-90">병원 내 위치 안내</div>
                      </div>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Voice Input */}
              <Card className="glass-card">
                <CardContent className="p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 text-center">음성으로 말씀해주세요</h3>

                  {!isRecording ? (
                    <Button
                      onClick={startRecording}
                      disabled={isLoading}
                      size="lg"
                      className="kiosk-button w-full h-14 sm:h-16 text-base sm:text-lg bg-green-500 hover:bg-green-600 shadow-lg shadow-green-200 transition-all duration-300"
                    >
                      <Mic className="w-5 h-5 sm:w-6 sm:h-6 mr-3" />🎤 음성 입력 시작
                    </Button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-red-700 font-medium">녹음 중...</span>
                        </div>
                        <Button
                          onClick={stopRecording}
                          size="sm"
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 text-sm"
                        >
                          <Square className="w-4 h-4 mr-1" />
                          녹음 중지
                        </Button>
                      </div>
                      <p className="text-sm text-red-600 mt-2 text-center">말씀하신 후 '녹음 중지' 버튼을 눌러주세요</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {/* Service Screen */}
          {currentScreen === "service" && (
            <>
              {/* TTS Display Area */}
              <Card className="glass-card">
                <CardContent className="p-4 sm:p-6">
                  <div className="bg-gradient-to-r from-green-100 to-green-200 p-4 sm:p-6 rounded-2xl border border-green-300/30">
                    <div className="flex items-start gap-3">
                      <Volume2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 mt-1 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-base sm:text-lg lg:text-xl font-medium text-gray-800 leading-relaxed mb-2">
                          {/* LLM 응답이 있으면 displayedLlmText, 없으면 기본 ttsDisplayText */}
                          {displayedLlmText || ttsDisplayText}
                        </p>
                        <div className="flex items-center justify-between">
                          {ttsText && (
                            <div className="text-sm sm:text-base text-green-700 flex items-center gap-2">{ttsText}</div>
                          )}
                          <div className="flex items-center gap-2">
                            {ttsDisplayText && !isTTSPlaying && (
                              <Button
                                onClick={() => {
                                  stopTTS()  
                                  playTTS(ttsDisplayText)}}
                                size="sm"
                                variant="outline"
                                className="text-xs px-2 py-1 border-green-300 text-green-600 hover:bg-green-50 bg-transparent"
                              >
                                <Volume2 className="w-3 h-3 mr-1" />
                                다시 듣기
                              </Button>
                            )}
                            {isTTSPlaying && (
                              <Button
                                onClick={stopTTS}
                                size="sm"
                                variant="outline"
                                className="text-xs px-2 py-1 border-red-300 text-red-600 hover:bg-red-50 bg-transparent"
                              >
                                <VolumeX className="w-3 h-3 mr-1" />
                                음성 중지
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Voice Input */}
              <Card className="glass-card">
                <CardContent className="p-4 sm:p-6">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 text-center">음성으로 답변해주세요</h3>

                  {!isRecording ? (
                    <Button
                      onClick={startRecording}
                      disabled={isLoading}
                      size="lg"
                      className="kiosk-button w-full h-14 sm:h-16 text-base sm:text-lg bg-green-500 hover:bg-green-600 shadow-lg shadow-green-200 transition-all duration-300"
                    >
                      <Mic className="w-5 h-5 sm:w-6 sm:h-6 mr-3" />🎤 음성 입력 시작
                    </Button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-red-700 font-medium">녹음 중...</span>
                        </div>
                        <Button
                          onClick={stopRecording}
                          size="sm"
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 text-sm"
                        >
                          <Square className="w-4 h-4 mr-1" />
                          녹음 중지
                        </Button>
                      </div>
                      <p className="text-sm text-red-600 mt-2 text-center">말씀하신 후 '녹음 중지' 버튼을 눌러주세요</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Processing Results
              {(sttText || displayedLlmText) && (
                <Card className="glass-card">
                  <CardContent className="p-4 sm:p-6 space-y-4">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-800">처리 결과</h3>

                    {sttText && (
                      <div className="bg-blue-50/80 p-3 sm:p-4 rounded-xl border border-blue-200/50">
                        <h4 className="text-sm sm:text-base font-bold text-blue-800 mb-2">음성 인식 결과</h4>
                        <p className="text-sm sm:text-base text-gray-700">{sttText}</p>
                      </div>
                    )}

                    {displayedLlmText && (
                      <div className="bg-purple-50/80 p-3 sm:p-4 rounded-xl border border-purple-200/50">
                        <h4 className="text-sm sm:text-base font-bold text-purple-800 mb-2">AI 응답</h4>
                        <div className="text-sm sm:text-base text-gray-700 leading-relaxed bg-white/70 rounded-lg p-3 sm:p-4 border border-purple-100">
                          <p className="subtitle-text">
                            {displayedLlmText}
                            {llmText && subtitleProgress < llmText.length && (
                              <span className="inline-block w-2 h-4 ml-1 bg-purple-400 animate-pulse"></span>
                            )}
                          </p>
                          {llmText && subtitleProgress < llmText.length && (
                            <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                              <div
                                className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${(subtitleProgress / llmText.length) * 100}%` }}
                              ></div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )} */}

              {/* Reception Result Display */}
              {receptionResult && (
                <Card className="glass-card">
                  <CardContent className="p-4 sm:p-6">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4">접수 완료</h3>
                    <div className="bg-green-50/80 p-4 rounded-xl border border-green-200/50">
                      <div className="space-y-2">
                        <p className="text-base sm:text-lg">
                          <strong>환자명:</strong> {userInfo.name}
                        </p>
                        <p className="text-base sm:text-lg">
                          <strong>진료과:</strong> {receptionResult.dept}
                        </p>
                        <p className="text-base sm:text-lg">
                          <strong>접수일:</strong> {receptionResult.date}
                        </p>
                        <p className="text-base sm:text-lg">
                          <strong>예약시간:</strong> {receptionResult.time}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Footer - Fixed */}
        <div className="bg-white/90 backdrop-blur-md border-t border-green-200/50 p-3 sm:p-4">
          <div className="flex justify-between items-center mb-2">
            {/* Back Button */}
            {currentScreen === "service" && (
              <Button
                onClick={goBackToServices}
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 border border-green-300 hover:bg-green-50 bg-transparent"
              >
                <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                이전
              </Button>
            )}

            {/* Reset Button */}
            {(currentScreen === "main" || currentScreen === "service") && (
              <Button
                onClick={resetToMain}
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 border border-green-300 hover:bg-green-50 bg-transparent"
              >
                <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                처음으로
              </Button>
            )}

            {/* Back to Start Button */}
            {(currentScreen === "main" || currentScreen === "service") && (
              <Button
                onClick={goBackToStart}
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 border border-orange-300 hover:bg-orange-50 bg-transparent text-orange-600"
              >
                <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                시작화면
              </Button>
            )}

            {/* Mode Reset Button */}
            {(currentScreen === "start" || currentScreen === "main" || currentScreen === "service") && (
              <Button
                onClick={resetToModeSelection}
                variant="outline"
                size="sm"
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 border border-purple-300 hover:bg-purple-50 bg-transparent text-purple-600"
              >
                <Settings className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                모드변경
              </Button>
            )}

            {/* Status */}
            <div className="text-xs sm:text-sm text-gray-600 text-center flex-1 mx-2 sm:mx-4">
              상태: {status}
              {isLoading && <span className="ml-2 animate-bounce">⏳</span>}
            </div>

            {/* Emergency Call */}
            <Button
              onClick={() => {
                stopTTS()
                setTtsDisplayText("직원을 호출하겠습니다. 잠시만 기다려주세요.")
                playTTS("직원을 호출하겠습니다. 잠시만 기다려주세요.")
              }}
              variant="outline"
              size="sm"
              className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 border border-red-300 hover:bg-red-50 text-red-600"
            >
              <Phone className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              직원호출
            </Button>
          </div>

          {/* Server Status - Only show in real mode */}
          {isSimulationMode === false && (
            <div className="flex justify-center space-x-3 sm:space-x-4">
              {[
                { key: "stt", label: "STT", status: healthStatus.stt },
                { key: "llm", label: "LLM", status: healthStatus.llm },
                { key: "tts", label: "TTS", status: healthStatus.tts },
              ].map((server) => (
                <div key={server.key} className="flex items-center space-x-1">
                  {server.status ? (
                    <CheckCircle className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-3 h-3 sm:w-4 sm:h-4 text-red-500" />
                  )}
                  <span className="text-xs text-gray-600">{server.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hidden Audio Element */}
        <audio ref={audioRef} style={{ display: "none" }} />
      </div>
    </div>
  )
}
