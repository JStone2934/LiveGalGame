"""
LLM Service for Web deployment.
Handles suggestion generation, affinity calculation, and review generation.
"""
import os
import re
import json
import asyncio
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from pathlib import Path

import httpx


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LLM_API_KEY = os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
LLM_TIMEOUT_MS = int(os.environ.get("LLM_TIMEOUT_MS", "30000"))

# Prompt templates
PROMPTS_DIR = Path(__file__).parent.parent / "src" / "core" / "prompts"


@dataclass
class Suggestion:
    """A single reply suggestion."""
    text: str
    affinity_delta: int
    tags: List[str]


@dataclass
class SuggestionResult:
    """Result of suggestion generation."""
    suggestions: List[Suggestion]
    skip: bool = False
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Prompt helpers
# ---------------------------------------------------------------------------
def load_prompt_template(name: str) -> str:
    """Load a prompt template from the prompts directory."""
    path = PROMPTS_DIR / f"{name}.prompt.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    # Fallback: return empty string
    return ""


def get_affinity_stage(affinity: int) -> Dict[str, str]:
    """Determine affinity stage based on value."""
    if affinity < 30:
        return {
            "label": "低好感（0-30）",
            "strategy": "建立信任，保持礼貌真诚，避免过度暧昧或冒进"
        }
    if affinity < 70:
        return {
            "label": "中好感（30-70）",
            "strategy": "适度暧昧，展示关心与幽默，逐步加深话题"
        }
    return {
        "label": "高好感（70+）",
        "strategy": "可以更直接和亲密，表达心意，但尊重边界"
    }


def analyze_emotion(messages: List[Dict]) -> Dict[str, str]:
    """Simple emotion analysis based on keywords."""
    if not messages:
        return {"label": "中性", "reason": "缺少有效内容"}
    
    last_msg = messages[-1]
    text = (last_msg.get("content") or last_msg.get("text") or "").lower()
    
    positive = ["谢谢", "感激", "喜欢", "开心", "愉快", "高兴", "满意"]
    negative = ["生气", "难过", "失望", "烦", "累", "不爽", "吵"]
    question = ["吗", "呢", "?", "？", "怎么", "为何", "可以", "要不要"]
    expectation = ["期待", "希望", "想", "盼", "等你", "一起", "约"]
    
    if any(kw in text for kw in negative):
        return {"label": "负面/不满", "reason": "检测到负面情绪词"}
    if any(kw in text for kw in positive):
        return {"label": "正向/愉快", "reason": "检测到积极情绪词"}
    if any(kw in text for kw in question):
        return {"label": "疑问/等待回应", "reason": "包含疑问/提问词"}
    if any(kw in text for kw in expectation):
        return {"label": "期待/邀请", "reason": "包含期待或邀请表达"}
    
    return {"label": "中性", "reason": "未命中显著情绪/提问关键词"}


def format_relative_time(timestamp: int) -> str:
    """Format timestamp as relative time string."""
    import time
    now = int(time.time() * 1000)
    diff = (now - timestamp) // 1000  # seconds
    
    if diff < 60:
        return f"{diff}秒前"
    if diff < 3600:
        return f"{diff // 60}分钟前"
    if diff < 86400:
        return f"{diff // 3600}小时前"
    return f"{diff // 86400}天前"


def format_message_history(messages: List[Dict]) -> str:
    """Format messages into a readable history string."""
    if not messages:
        return "暂无历史消息。"
    
    lines = []
    for msg in messages:
        sender = "玩家" if msg.get("sender") == "user" else "角色"
        content = (msg.get("content") or msg.get("text") or "")[:500]
        timestamp = msg.get("timestamp")
        time_tag = format_relative_time(timestamp) if timestamp else ""
        prefix = f"[{time_tag}] " if time_tag else ""
        lines.append(f"{prefix}{sender}：{content}")
    
    return "\n".join(lines)


def build_character_profile(character: Dict, details: Optional[Dict] = None) -> str:
    """Build a character profile string for the prompt."""
    if not character:
        return "角色信息未知。"
    
    parts = [f"角色：{character.get('name', '未知')}"]
    
    if character.get("relationship_label"):
        parts.append(f"关系：{character['relationship_label']}")
    
    affinity = character.get("affinity")
    if isinstance(affinity, (int, float)):
        parts.append(f"当前好感度：{int(affinity)}")
        stage = get_affinity_stage(int(affinity))
        parts.append(f"好感阶段：{stage['label']}")
    
    if details:
        # Personality traits
        traits = details.get("personality_traits")
        if traits:
            if isinstance(traits, str):
                try:
                    traits = json.loads(traits)
                except:
                    traits = []
            if isinstance(traits, list) and traits:
                trait_strs = []
                for t in traits[:3]:
                    if isinstance(t, str):
                        trait_strs.append(t)
                    elif isinstance(t, dict) and t.get("name"):
                        trait_strs.append(t["name"])
                if trait_strs:
                    parts.append(f"性格关键词：{'、'.join(trait_strs)}")
        
        # Likes/dislikes
        likes_dislikes = details.get("likes_dislikes")
        if likes_dislikes:
            if isinstance(likes_dislikes, str):
                try:
                    likes_dislikes = json.loads(likes_dislikes)
                except:
                    likes_dislikes = {}
            if isinstance(likes_dislikes, dict):
                likes = likes_dislikes.get("likes", [])
                dislikes = likes_dislikes.get("dislikes", [])
                if likes:
                    parts.append(f"喜好：{'、'.join(likes[:2])}")
                if dislikes:
                    parts.append(f"忌讳：{'、'.join(dislikes[:2])}")
    
    # Tags
    tags = character.get("tags", [])
    if tags:
        parts.append(f"标签：{'、'.join(tags[:3])}")
    
    return " | ".join(parts)


# ---------------------------------------------------------------------------
# TOON Parser (parse LLM output into structured suggestions)
# ---------------------------------------------------------------------------
def parse_toon_suggestions(text: str) -> List[Suggestion]:
    """
    Parse TOON format suggestions from LLM output.
    Format: suggestions[N]{suggestion,affinity_delta,tags}:
            line1,delta1,tag1,tag2
            line2,delta2,tag3,tag4
    """
    suggestions = []
    
    # Check for SKIP
    if text.strip().upper() == "SKIP":
        return []
    
    # Find the TOON block
    lines = text.strip().split("\n")
    in_block = False
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Detect header
        if line.startswith("suggestions[") and "{" in line:
            in_block = True
            continue
        
        if not in_block:
            # Also try to parse lines that look like suggestions
            if "," in line and not line.startswith("#") and not line.startswith("【"):
                in_block = True
            else:
                continue
        
        # Skip comments and metadata
        if line.startswith("#") or line.startswith("【"):
            continue
        
        # Parse suggestion line: "建议内容,好感度变化,标签1、标签2"
        parts = line.split(",")
        if len(parts) >= 2:
            suggestion_text = parts[0].strip()
            
            # Try to extract affinity_delta (number)
            affinity_delta = 5  # default
            tags = []
            
            for i, part in enumerate(parts[1:], 1):
                part = part.strip()
                # Check if it's a number
                try:
                    affinity_delta = int(part)
                except ValueError:
                    # It's a tag
                    # Split by 、 or other separators
                    tag_parts = re.split(r"[、/]", part)
                    tags.extend([t.strip() for t in tag_parts if t.strip()])
            
            if suggestion_text and len(suggestion_text) > 2:
                suggestions.append(Suggestion(
                    text=suggestion_text,
                    affinity_delta=min(10, max(0, affinity_delta)),
                    tags=tags[:3]  # Limit tags
                ))
    
    return suggestions


# ---------------------------------------------------------------------------
# LLM Client
# ---------------------------------------------------------------------------
class LLMClient:
    """Async HTTP client for LLM API calls."""
    
    def __init__(self, api_key: str = None, base_url: str = None, model: str = None):
        self.api_key = api_key or LLM_API_KEY
        self.base_url = (base_url or LLM_BASE_URL).rstrip("/")
        self.model = model or LLM_MODEL
        self.timeout = LLM_TIMEOUT_MS / 1000  # Convert to seconds
    
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 1024
    ) -> str:
        """Make a chat completion request."""
        if not self.api_key:
            raise ValueError("LLM API key not configured")
        
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # Extract content from response
            choices = data.get("choices", [])
            if choices:
                return choices[0].get("message", {}).get("content", "")
            return ""


# ---------------------------------------------------------------------------
# Suggestion Service
# ---------------------------------------------------------------------------
class SuggestionService:
    """Service for generating reply suggestions."""
    
    def __init__(self, llm_client: LLMClient = None):
        self.llm = llm_client or LLMClient()
        self.prompt_template = load_prompt_template("suggestion")
    
    def build_prompt(
        self,
        character: Dict,
        messages: List[Dict],
        character_details: Optional[Dict] = None,
        user_profile: Optional[Dict] = None,
        trigger_type: str = "manual",
        previous_suggestions: Optional[List[str]] = None,
        count: int = 3
    ) -> str:
        """Build the suggestion prompt from template."""
        
        # Build context
        affinity = character.get("affinity", 50) if character else 50
        affinity_stage = get_affinity_stage(int(affinity))
        emotion = analyze_emotion(messages)
        
        character_profile = build_character_profile(character, character_details)
        history_text = format_message_history(messages)
        
        # Trigger label
        trigger_labels = {
            "manual": "用户主动请求",
            "silence": "静默检测（沉默超时）",
            "refresh": "用户点击「换一批」",
            "auto": "自动触发"
        }
        trigger_label = trigger_labels.get(trigger_type, "用户主动请求")
        
        # Trigger guidance
        trigger_guidance_map = {
            "manual": "用户主动请求建议，请提供多元化选项",
            "silence": "检测到对话沉默，优先提供破冰/延续话题的建议",
            "refresh": "用户请求换一批，请生成与上一批不同方向的建议",
            "auto": "自动触发，根据对话状态判断是否需要建议"
        }
        trigger_guidance = trigger_guidance_map.get(trigger_type, trigger_guidance_map["manual"])
        
        # Skip rule based on trigger
        if trigger_type in ("manual", "refresh"):
            skip_rule = "由于是用户主动请求，请务必输出建议，不要输出 SKIP"
        else:
            skip_rule = "如果对方话未说完、正在打字、或已经回复且不需要更多建议，输出 SKIP"
        
        # Previous suggestions text
        previous_text = ""
        if previous_suggestions:
            prev_lines = [f"{i+1}. {s}" for i, s in enumerate(previous_suggestions)]
            previous_text = f"\n【上一批建议】\n" + "\n".join(prev_lines)
        
        # User profile text
        user_profile_text = "用户未填写个人档案"
        if user_profile:
            profile_parts = []
            if user_profile.get("nickname"):
                profile_parts.append(f"昵称：{user_profile['nickname']}")
            if user_profile.get("personality"):
                profile_parts.append(f"性格：{user_profile['personality']}")
            if user_profile.get("style"):
                profile_parts.append(f"聊天风格：{user_profile['style']}")
            if profile_parts:
                user_profile_text = " | ".join(profile_parts)
        
        # Build prompt from template
        prompt = self.prompt_template
        if not prompt:
            # Fallback minimal prompt
            prompt = f"""你是恋爱互动教练。根据以下对话历史，生成 {count} 条回复建议。

<角色档案>{character_profile}
<对话历史>
{history_text}
<情感分析>{emotion['label']}（{emotion['reason']}）

输出格式：
suggestions[{count}]{{suggestion,affinity_delta,tags}}:
建议内容,好感度变化(0-10),标签1、标签2

请输出 {count} 条不同策略的建议："""
        else:
            # Replace placeholders
            prompt = prompt.replace("{{count}}", str(count))
            prompt = prompt.replace("{{skipRule}}", skip_rule)
            prompt = prompt.replace("{{triggerLabel}}", trigger_label)
            prompt = prompt.replace("{{triggerGuidance}}", trigger_guidance)
            prompt = prompt.replace("{{characterProfile}}", character_profile)
            prompt = prompt.replace("{{affinityStageText}}", f"{affinity_stage['label']}：{affinity_stage['strategy']}")
            prompt = prompt.replace("{{userProfile}}", user_profile_text)
            prompt = prompt.replace("{{historyText}}", history_text)
            prompt = prompt.replace("{{emotionText}}", f"{emotion['label']}（{emotion['reason']}）")
            prompt = prompt.replace("{{previousSuggestionText}}", previous_text)
        
        return prompt
    
    async def generate(
        self,
        character: Dict,
        messages: List[Dict],
        character_details: Optional[Dict] = None,
        user_profile: Optional[Dict] = None,
        trigger_type: str = "manual",
        previous_suggestions: Optional[List[str]] = None,
        count: int = 3
    ) -> SuggestionResult:
        """Generate reply suggestions."""
        
        prompt = self.build_prompt(
            character=character,
            messages=messages,
            character_details=character_details,
            user_profile=user_profile,
            trigger_type=trigger_type,
            previous_suggestions=previous_suggestions,
            count=count
        )
        
        try:
            response = await self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,
                max_tokens=1024
            )
            
            # Check for SKIP
            if response.strip().upper() == "SKIP":
                return SuggestionResult(suggestions=[], skip=True)
            
            # Parse suggestions
            suggestions = parse_toon_suggestions(response)
            
            return SuggestionResult(
                suggestions=suggestions,
                skip=False,
                metadata={
                    "model": self.llm.model,
                    "raw_response": response[:500]  # Truncate for debugging
                }
            )
        
        except Exception as e:
            return SuggestionResult(
                suggestions=[],
                skip=False,
                metadata={"error": str(e)}
            )


# ---------------------------------------------------------------------------
# Singleton instances
# ---------------------------------------------------------------------------
_llm_client: Optional[LLMClient] = None
_suggestion_service: Optional[SuggestionService] = None


def get_llm_client() -> LLMClient:
    """Get or create the global LLM client."""
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client


def get_suggestion_service() -> SuggestionService:
    """Get or create the global suggestion service."""
    global _suggestion_service
    if _suggestion_service is None:
        _suggestion_service = SuggestionService(get_llm_client())
    return _suggestion_service
