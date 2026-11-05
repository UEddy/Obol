"""Deterministic security checks for the money path. No model involved, so a fooled model can't turn them off.

1. Prompt-injection detection for forwarded messages (direct, hidden, multilingual, encoded).
2. Lookalike-domain detection for billing emails (homoglyphs such as rn->m, 0->o, Cyrillic а->a;
   one- or two-character typos; the same name on another domain; a known name with extra words).

These flag; Obol's other rules decide what happens: intake never auto-fills a recipient from a
message that tried to inject instructions, and every Stripe write still needs a person to approve.
"""

from __future__ import annotations

import base64
import binascii
import re
import unicodedata
import urllib.parse
from typing import Iterable, Optional

# -- text normalisation --------------------------------------------------------------------------
_ZERO_WIDTH = dict.fromkeys([0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD, 0x180E], None)
_BIDI = dict.fromkeys([0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0x200E, 0x200F], None)
_TAG_RANGE = (0xE0000, 0xE007F)  # Unicode "tag" characters: invisible ASCII smuggling


def _untag(text: str) -> tuple[str, str]:
    """Split out Unicode tag characters (they map 1:1 onto hidden ASCII)."""
    visible, hidden = [], []
    for ch in text:
        cp = ord(ch)
        if _TAG_RANGE[0] <= cp <= _TAG_RANGE[1]:
            if 0xE0020 <= cp <= 0xE007E:
                hidden.append(chr(cp - 0xE0000))
        else:
            visible.append(ch)
    return "".join(visible), "".join(hidden)


def normalize(text: str) -> tuple[str, list[str]]:
    """Return (normalised text, hidden-technique labels found)."""
    techniques = []
    text, smuggled = _untag(text)
    if smuggled:
        techniques.append("invisible Unicode tag characters")
    if any(ord(c) in _ZERO_WIDTH for c in text):
        techniques.append("zero-width characters")
    if any(ord(c) in _BIDI for c in text):
        techniques.append("bidirectional-override characters")
    text = text.translate(_ZERO_WIDTH).translate(_BIDI)
    text = unicodedata.normalize("NFKC", text)
    if smuggled:
        text = f"{text}\n{smuggled}"
    return text, techniques


def _decoded_layers(text: str) -> list[tuple[str, str]]:
    """Text hidden in encodings or markup, as (technique, decoded text)."""
    layers: list[tuple[str, str]] = []
    for m in re.finditer(r"<!--(.*?)-->", text, re.S):
        layers.append(("HTML comment", m.group(1)))
    for m in re.finditer(r"[A-Za-z0-9+/]{16,}={0,2}", text):
        blob = m.group(0)
        try:
            raw = base64.b64decode(blob + "=" * (-len(blob) % 4), validate=True)
            dec = raw.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError):
            continue
        if sum(c.isprintable() or c.isspace() for c in dec) >= 0.9 * len(dec) and re.search(r"[A-Za-z]{3}", dec):
            layers.append(("base64-encoded text", dec))
    if re.search(r"%[0-9A-Fa-f]{2}", text):
        dec = urllib.parse.unquote(text)
        if dec != text:
            layers.append(("URL-encoded text", dec))
    for m in re.finditer(r"(?:\\x[0-9a-fA-F]{2}){8,}", text):
        try:
            layers.append(("hex-escaped text", bytes.fromhex(m.group(0).replace("\\x", "")).decode("utf-8")))
        except (ValueError, UnicodeDecodeError):
            pass
    return layers


# -- injection patterns --------------------------------------------------------------------------
_EMAIL = r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"
_PATTERNS: list[tuple[str, str]] = [
    # English
    ("override", r"\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(instructions?|rules|prompts?|guardrails?|system\s+(message|prompt)|polic(y|ies))\b"),
    ("override", r"\b(new|updated|real)\s+(system\s+)?(instructions|prompt|rules)\b"),
    ("role", r"\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|system|developer)\b|\bsystem\s*prompt\b|\bdeveloper\s+mode\b"),
    ("skip_approval", r"\b(skip|bypass|without|no\s+need\s+for|don'?t\s+(ask|wait)\s+for)\b[^.\n]{0,25}\b(approval|confirmation|review|checks?|asking)\b"),
    ("auto_send", r"\b(send|email|issue|pay|process)\b[^.\n]{0,40}\b(automatically|without\s+(asking|confirm\w*|approv\w*|review\w*|checking))\b"),
    ("redirect", r"\b(change|update|switch)\b[^.\n]{0,30}\b(recipient|billing\s+email|email\s+address|bank|account\s+(number|details)|payment\s+details|routing|remittance)\b"),
    ("redirect", r"\b(new|different|updated)\s+(bank|account|payment|remittance|billing)\s+(details|account|address|email|info)\b"),
    ("tool_call", r"\b(call|run|invoke|execute|use)\s+(the\s+)?(tool\s+)?`?obol_\w+"),
    # Spanish, French, German, Portuguese, Italian
    ("override", r"\bignora(r)?\b[^.\n]{0,30}\binstrucciones\b|\bolvida\b[^.\n]{0,30}\binstrucciones\b"),
    ("override", r"\bignore[zr]?\b[^.\n]{0,30}\b(les\s+)?(instructions|consignes)\b|\boublie[zr]?\b[^.\n]{0,30}\binstructions\b"),
    ("override", r"\bignorier(e|en)?\b[^.\n]{0,40}\b(anweisungen|anweisung|regeln)\b"),
    ("override", r"\bignor[ae]r?\b[^.\n]{0,30}\b(as\s+)?instru[çc][õo]es\b|\bignora\b[^.\n]{0,30}\bistruzioni\b"),
    # Chinese, Japanese, Russian, Arabic
    ("override", r"忽略[^。\n]{0,10}(指令|指示|说明)|无视[^。\n]{0,10}(指令|指示)"),
    ("override", r"(指示|命令)を無視|無視して"),
    ("override", r"игнорир\w*[^.\n]{0,30}(инструкц\w*|указани\w*)"),
    ("override", r"تجاهل[^.\n]{0,30}التعليمات"),
]
_COMPILED = [(name, re.compile(rx, re.I)) for name, rx in _PATTERNS]
_SEVERITY = {"redirect": "medium"}  # everything else is high
_LABELS = {
    "override": "tries to override Hermes's instructions",
    "role": "tries to change the assistant's role",
    "skip_approval": "asks to skip approval or checks",
    "auto_send": "asks to send or pay without confirmation",
    "redirect": "tries to change where the invoice or money goes",
    "tool_call": "tries to trigger an Obol tool directly",
}


def _snippet(text: str, start: int, end: int) -> str:
    s = max(0, start - 20)
    out = text[s:min(len(text), end + 20)].replace("\n", " ").strip()
    return out[:140]


def detect_injection(message: str) -> list[dict]:
    """Findings for instructions embedded in a forwarded message. Empty list = nothing found."""
    if not isinstance(message, str) or not message:
        return []
    text, hidden = normalize(message)
    layers = [("plain text", text)] + _decoded_layers(text)
    findings: list[dict] = []
    seen: set[str] = set()
    for technique, body in layers:
        for name, rx in _COMPILED:
            m = rx.search(body)
            if not m or name in seen:
                continue
            seen.add(name)
            how = technique if technique != "plain text" else (", ".join(hidden) if hidden else "plain text")
            findings.append({
                "check": "prompt_injection", "severity": _SEVERITY.get(name, "high"), "kind": name, "technique": how,
                "message": f"Forwarded message {_LABELS[name]} ({how}): “{_snippet(body, m.start(), m.end())}”",
            })
    if any(f["severity"] == "high" for f in findings):
        targets = sorted(emails_in("\n".join(body for _, body in layers)))
        if targets:
            findings[0]["targets"] = targets
            findings[0]["message"] += f" Addresses in the message: {', '.join(targets)}."
    if hidden and not findings:
        findings.append({"check": "prompt_injection", "severity": "medium", "kind": "hidden_text", "technique": ", ".join(hidden),
                         "message": f"Forwarded message contains hidden text ({', '.join(hidden)}). Review it before billing."})
    return findings


def emails_in(text: str) -> set[str]:
    return {e.lower() for e in re.findall(_EMAIL, normalize(text)[0])}


# -- lookalike domains ---------------------------------------------------------------------------
# Public suffixes we know of (no network, no PSL download). The brand is the label before them.
_SUFFIXES = sorted([
    "example.com", "example.org", "example.net", "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.jp",
    "com.br", "co.in", "co.za", "com.mx", "com.sg", "com.ng", "co.ke",
], key=len, reverse=True)
_FREE_MAIL = {"gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "me", "proton", "protonmail", "aol", "gmx", "zoho"}
_CONFUSABLE = str.maketrans({
    "0": "o", "1": "l", "3": "e", "5": "s", "7": "t", "8": "b", "9": "g", "|": "l", "!": "i", "$": "s",
    # Cyrillic / Greek letters that look Latin
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
    "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ο": "o", "α": "a", "ρ": "p", "ν": "v", "ι": "i", "κ": "k", "τ": "t",
})


def split_domain(domain: str) -> tuple[str, str]:
    """('pinemoor', 'example.com') for 'billing.pinemoor.example.com'."""
    d = domain.lower().strip(".")
    for suffix in _SUFFIXES:
        if d.endswith("." + suffix):
            head = d[: -len(suffix) - 1]
            return head.split(".")[-1], suffix
    parts = d.split(".")
    if len(parts) == 1:
        return parts[0], ""
    return parts[-2], parts[-1]


def skeleton(label: str) -> str:
    s = unicodedata.normalize("NFKC", label.lower()).translate(_CONFUSABLE)
    s = s.replace("rn", "m").replace("vv", "w").replace("cl", "d").replace("ii", "u")
    s = s.replace("l", "i")  # l/I/1 all look alike
    return re.sub(r"[-_.]", "", s)


def _distance(a: str, b: str) -> int:
    """Damerau-Levenshtein (optimal string alignment)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[-1][-1]


def lookalike_reason(new_domain: str, known_domain: str) -> Optional[str]:
    """Why ``new_domain`` looks like ``known_domain`` (None if it doesn't, or they're the same)."""
    if new_domain.lower() == known_domain.lower():
        return None
    nb, ns = split_domain(new_domain)
    kb, ks = split_domain(known_domain)
    if not nb or not kb or kb in _FREE_MAIL or nb in _FREE_MAIL:
        return None
    if nb == kb and ns != ks:
        return "same name on a different domain"
    if nb == kb:
        return None  # same organisation, different subdomain/mailbox
    if skeleton(nb) == skeleton(kb):
        return "look-alike characters"
    if len(kb) >= 4:
        limit = 1 if len(kb) < 8 else 2
        if _distance(nb, kb) <= limit:
            return "one or two characters different"
        if kb in re.split(r"[-_]", nb) or (nb.startswith(kb) and len(nb) - len(kb) <= 8) or (nb.endswith(kb) and len(nb) - len(kb) <= 8):
            return "known name with extra words"
    return None


def lookalike_findings(email: str, known_emails: Iterable[str]) -> list[dict]:
    """Flag ``email`` when its domain imitates a domain you have already billed."""
    if "@" not in (email or ""):
        return []
    domain = email.rsplit("@", 1)[1].lower()
    known_domains = {e.rsplit("@", 1)[1].lower() for e in known_emails if "@" in e}
    if domain in known_domains:
        return []
    for kd in sorted(known_domains):
        reason = lookalike_reason(domain, kd)
        if reason:
            return [{"check": "lookalike_domain", "severity": "high",
                     "message": f"{domain} looks like {kd}, a domain you've billed before ({reason}). "
                                "Possible impersonation: verify with the client through a channel you already trust."}]
    return []
