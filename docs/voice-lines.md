# Voice lines: recording sheet

Every line a player can say, in the order of the match. The game plays the voice each player picks in the room dialog (Hindi, English or grunts only). The Hindi and English lines are placeholders made by text-to-speech until they are recorded; recordings drop in by file name. The jump, climb, pain and death sounds are recordings already ([sources](data-sources.md#voices)).

**Tiers.** Clean and Spicy lines always play. 18+ lines play only for listeners who turn on "Hear 18+ lines" in the room dialog; everyone else hears a clean line from the same moment instead.

## How to record

1. Record each line as its own file, named after the File column: `assets-src/voices/hi/round-go.wav` for the Hindi `round-go`, `assets-src/voices/en/round-go.wav` for the English. WAV, M4A, MP3, OGG, FLAC and AIFF all work. Phone voice memos are fine.
2. Say it as you would in the middle of a fight: short, loud and with feeling, not read out. Stand about 20 cm from the microphone, in a quiet room with soft furnishings, and leave a moment of silence before and after.
3. Run `npm run build:voices`. It trims the silence, evens out the level and replaces the placeholder of every line you have recorded, leaving the rest. Commit what changed in `public/audio/voice/`.

Record one take per line; the game varies the pitch a little each time it plays. A line can be reworded freely, as long as the file keeps its name. To add or remove lines, edit `src/game/voiceLines.json`.

## Lines

| File | When | Tier | Hindi | Say it as | English |
|---|---|---|---|---|---|
| `round-go` | A round starts | Clean | चलो, शुरू करते हैं! | Chalo, shuru karte hain! | Let's do this! |
| `round-ready` | A round starts | Clean | तैयार हो जाओ! | Taiyaar ho jao! | Get ready! |
| `round-band` | A round starts | Spicy | आज सबकी बैंड बजेगी! | Aaj sabki band bajegi! | Everybody's going down today! |
| `win-jeet` | Wins the round | Clean | जीत गए! | Jeet gaye! | We won! |
| `win-bhagwan` | Wins the round | Spicy | अपुन ही भगवान है! | Apun hi bhagwan hai! | Who's the boss now? |
| `win-jhakaas` | Wins the round | Spicy | झकास! | Jhakaas! | Sweet! |
| `lose-agli` | Loses the round | Clean | अगली बार देख लेंगे। | Agli baar dekh lenge. | Next time, then. |
| `lose-kismat` | Loses the round | Clean | किस्मत ही ख़राब है। | Kismat hi kharab hai. | Just bad luck. |
| `lose-bakwaas` | Loses the round | Spicy | बकवास! | Bakwaas! | Garbage! |
| `lose-harami` | Loses the round | 18+ | हरामी लोग! | Harami log! | Bastards! |
| `reload-kar` | Reloads | Clean | रीलोड कर रहा हूँ! | Reload kar raha hoon! | Reloading! |
| `reload-cover` | Reloads | Clean | कवर दे! | Cover de! | Cover me! |
| `empty-goli` | Out of ammunition | Clean | गोली ख़त्म! | Goli khatam! | I'm out! |
| `empty-khaali` | Out of ammunition | Clean | अरे, ख़ाली है! | Arre, khaali hai! | It's empty! |
| `grenade-hato` | Throws a frag | Clean | ग्रेनेड! हटो! | Grenade! Hato! | Grenade out! |
| `grenade-sambhaal` | Throws a frag | Spicy | ले, संभाल! | Le, sambhaal! | Catch this! |
| `smoke-dhuaan` | Throws smoke | Clean | धुआँ डाल रहा हूँ! | Dhuaan daal raha hoon! | Smoke out! |
| `near-bhaago` | A frag lands within 6 m | Clean | भागो! | Bhaago! | Run! |
| `miss-baap` | A round passes within 1.5 m | Clean | अरे बाप रे! | Arre baap re! | Whoa! |
| `miss-bal` | A round passes within 1.5 m | Clean | बाल-बाल बचे! | Bal-bal bache! | That was close! |
| `miss-kaun` | A round passes within 1.5 m | Clean | कौन मार रहा है? | Kaun maar raha hai? | Who's shooting? |
| `miss-pagal` | A round passes within 1.5 m | Spicy | पागल है क्या? | Pagal hai kya? | Are you crazy? |
| `miss-gaandu` | A round passes within 1.5 m | 18+ | गांडू, ढंग से मार! | Gaandu, dhang se maar! | Learn to aim, asshole! |
| `hurt-lag` | Hit | Clean | लग गई! | Lag gayi! | I'm hit! |
| `hurt-teri` | Hit | Spicy | तेरी तो...! | Teri toh...! | Oh, you...! |
| `hurt-bc` | Hit | 18+ | बहनचोद! | Behenchod! | Son of a bitch! |
| `low-jaan` | Hit down to 25 health or less, once a life | Clean | बस थोड़ी सी जान बची है। | Bas thodi si jaan bachi hai. | I'm barely standing. |
| `death-gaya` | Last words, after the death cry | Clean | गया मैं... | Gaya main... | I'm done... |
| `death-kamina` | Last words, after the death cry | Spicy | कमीना... | Kamina... | Jerk... |
| `death-mc` | Last words, after the death cry | 18+ | मादरचोद... | Madarchod... | Motherfucker... |
| `kill-gaya` | Gets a kill | Clean | गया! | Gaya! | Gotcha! |
| `kill-ekaur` | Gets a kill | Clean | एक और! | Ek aur! | One more! |
| `kill-mazaa` | Gets a kill | Clean | मज़ा आ गया! | Mazaa aa gaya! | That was fun! |
| `kill-beta` | Gets a kill | Spicy | ले बेटा! | Le beta! | Take that! |
| `kill-nikal` | Gets a kill | Spicy | चल निकल! | Chal nikal! | Get lost! |
| `kill-darr` | Gets a kill | Spicy | क्या रे, डर गया? | Kya re, darr gaya? | Scared, huh? |
| `kill-ullu` | Gets a kill | Spicy | उल्लू का पट्ठा! | Ullu ka pattha! | Idiot! |
| `kill-bsdk` | Gets a kill | 18+ | भोसड़ीके, ले! | Bhosdike, le! | Eat it, motherfucker! |
| `kill-chutiya` | Gets a kill | 18+ | चूतिया कहीं का! | Chutiya kahin ka! | What a dumbass! |
| `head-khopdi` | Kills with a headshot | Clean | सीधा खोपड़ी में! | Seedha khopdi mein! | Right between the eyes! |
| `head-bheja` | Kills with a headshot | Spicy | भेजा फ़्राई! | Bheja fry! | Brains fried! |
| `knife-chaku` | Kills with the knife | Clean | चाकू चल गया! | Chaaku chal gaya! | Knifed! |
| `double-teer` | A second kill within 4 s | Clean | एक तीर, दो शिकार! | Ek teer, do shikaar! | Two for one! |
| `double-dhamaal` | A second kill within 4 s | Spicy | धमाल! | Dhamaal! | Double trouble! |
| `revenge-hisaab` | Kills whoever last killed them | Clean | हिसाब बराबर। | Hisaab barabar. | Now we're even. |
| `respawn-wapas` | Respawns | Clean | वापस आ गया! | Wapas aa gaya! | I'm back! |
| `respawn-picture` | Respawns | Spicy | पिक्चर अभी बाक़ी है, मेरे दोस्त! | Picture abhi baaki hai, mere dost! | The show's not over yet! |
