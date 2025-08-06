import re

def slash_filter(text, pick='right'):
    # (A)/(B) → B 또는 A
    if pick == 'right':
        return re.sub(r'\(([^/)]+)\)/\(([^)]+)\)', r'\2', text)
    elif pick == 'left':
        return re.sub(r'\(([^/)]+)\)/\(([^)]+)\)', r'\1', text)
    else:
        raise ValueError("pick must be 'left' or 'right'")

def normalize_full_transcript(text, pick='right'):
    # 1. 슬래시 구조 (A)/(B) 처리
    text = slash_filter(text, pick=pick)

    # 2. 맨 앞의 n/ 제거
    text = re.sub(r'^n/\s*', '', text)

    # 3. 대괄호 [...] 전체 제거
    text = re.sub(r'\[[^\]]*\]', '', text)

    # 4. + 제거 (발화 중단 마커)
    text = text.replace('+', '')

    # 5. / 제거 (단어 중간 또는 문장 중간 슬래시)
    text = text.replace('/', '')

    # 6. 중복 공백 정리
    text = re.sub(r'\s+', ' ', text)

    return text.strip()
