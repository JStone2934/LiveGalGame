package com.jstone.livegalgame.speech

import com.jstone.livegalgame.model.KeywordTrigger
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

class KeywordSpeechListener(
    initialTriggers: List<KeywordTrigger> = emptyList()
) {

    private val _keywordTriggers = MutableSharedFlow<KeywordTrigger>(extraBufferCapacity = 1)
    val keywordTriggers: SharedFlow<KeywordTrigger> = _keywordTriggers

    private var isListening: Boolean = false
    private var lastTriggeredHash: Int? = null
    private var triggers: List<KeywordTrigger> = initialTriggers

    fun updateTriggers(updated: List<KeywordTrigger>) {
        triggers = updated
        lastTriggeredHash = null
    }

    fun startListening() {
        isListening = true
        lastTriggeredHash = null
    }

    fun stopListening() {
        isListening = false
    }

    fun release() {
        stopListening()
        lastTriggeredHash = null
    }

    fun onRecognizedText(text: String, isFinal: Boolean) {
        if (!isListening) return
        val normalized = text.trim()
        if (normalized.isEmpty()) return

        val matched = triggers.firstOrNull { normalized.contains(it.keyword) } ?: return

        val baseHash = 31 * normalized.hashCode() + matched.keyword.hashCode()
        val hash = 31 * baseHash + if (isFinal) 1 else 0
        if (hash == lastTriggeredHash) return

        lastTriggeredHash = hash
        _keywordTriggers.tryEmit(matched)
    }
}
