# Voice lines: recording sheet

Every line a player can say, in the order of the match, and the [memes](#memes) played on top. The game plays the language each player picks on the setup screen or in the room dialog, Hindi or English; a player who turns voice lines off makes only the grunts and cries. The English lines are placeholders made by text-to-speech until they are recorded; the Hindi lines are silent until they are recorded, as no synthesised Hindi is good enough. Recordings drop in by file name. The jump, climb, pain and death sounds are recordings already ([sources](data-sources.md#voices)).

**Tiers.** Clean and Spicy lines always play. 18+ lines play only for listeners who turn on "Hear 18+ lines" in the room dialog; everyone else hears a clean line from the same moment instead.

## How to record

1. Record each line as its own file, named after the File column: `assets-src/voices/hi/round-go.wav` for the Hindi `round-go`, `assets-src/voices/en/round-go.wav` for the English. WAV, M4A, MP3, OGG, FLAC and AIFF all work. Phone voice memos are fine.
2. Say it as you would in the middle of a fight: short, loud and with feeling, not read out. Stand about 20 cm from the microphone, in a quiet room with soft furnishings, and leave a moment of silence before and after.
3. Run `npm run build:voices`. It trims the silence, evens out the level and replaces the placeholder of every line you have recorded, leaving the rest. Commit what changed in `public/audio/voice/` (and `public/audio/meme/` for memes).

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
| `double-teer` | A second kill within 4 s | Clean | एक तीर, दो शिकार! | Ek teer, do shikaar! | Two for one! |
| `double-dhamaal` | A second kill within 4 s | Spicy | धमाल! | Dhamaal! | Double trouble! |
| `revenge-hisaab` | Kills whoever last killed them | Clean | हिसाब बराबर। | Hisaab barabar. | Now we're even. |
| `respawn-wapas` | Respawns | Clean | वापस आ गया! | Wapas aa gaya! | I'm back! |
| `respawn-picture` | Respawns | Spicy | पिक्चर अभी बाक़ी है, मेरे दोस्त! | Picture abhi baaki hai, mere dost! | The show's not over yet! |

## Memes

Meme lines and sound effects play on top of the voices, at the moments below ([how they are picked](audio.md)). The sound effects ship with the game (`npm run build:memes` rebuilds them from their sources). A meme line plays once its clip is added: put it in `assets-src/memes/`, named after its code (`H1.wav`, `E6a.m4a`; WAV, M4A, MP3, OGG, FLAC and AIFF all work), and run `npm run build:voices`, which trims it, evens out its level and writes `public/audio/meme/<code>.mp3`. A line can be your own recording or the original clip; clips from films, shows and songs belong to their owners, and putting them on the public site risks a copyright takedown. Lines are in the speaker's language; grunts-only players set off only the sound effects. To change a meme's moment, tier or chance, edit `src/game/memes.json`.

| Code | Meme | From | Language | When | Tier | File |
|---|---|---|---|---|---|---|
| H1 | Kitne aadmi the? | Sholay (1975) | Hindi | A round starts | Clean | `assets-src/memes/H1.wav` |
| H2 | How's the josh? | Uri (2019) | Hindi | A round starts | Clean | `assets-src/memes/H2.wav` |
| H3 | Jaa Simran, jaa | DDLJ (1995) | Hindi | Sprints for 4 s | Clean | `assets-src/memes/H3.wav` |
| H4 | Bhaag D.K. Bose | Delhi Belly (2011), song | Hindi | Sprints for 4 s | 18+ | `assets-src/memes/H4.wav` |
| H5 | Hey Maa, Mataji! | Taarak Mehta Ka Ooltah Chashmah | Hindi | A frag lands within 6 m | Clean | `assets-src/memes/H5.wav` |
| H6 | Rasode mein kaun tha? | Yashraj Mukhate remix (2020) | Hindi | A round passes within 1.5 m | Clean | `assets-src/memes/H6.wav` |
| H7 | Daya, kuch toh gadbad hai | CID | Hindi | A round passes within 1.5 m | Clean | `assets-src/memes/H7.wav` |
| H8 | Daya, darwaza tod do | CID | Hindi | Shoots glass | Clean | `assets-src/memes/H8.wav` |
| H9 | Thappad se darr nahi lagta, sahab | Dabangg (2010) | Hindi | Hit | Clean | `assets-src/memes/H9.wav` |
| H10 | Mogambo khush hua | Mr. India (1987) | Hindi | Gets a kill | Clean | `assets-src/memes/H10.wav` |
| H11 | Dekh raha hai Binod? | Slayy Point video (2020) | Hindi | Gets a kill | Clean | `assets-src/memes/H11.wav` |
| H12 | Bachcha hai tu mera | Dhurandhar 2 (2026) | Hindi | Gets a kill | Spicy | `assets-src/memes/H12.wav` |
| H13 | Ab tera kya hoga, Kaaliya? | Sholay (1975) | Hindi | Hits someone down to 25 health or less | Clean | `assets-src/memes/H13.wav` |
| H14 | Arre o Sambha, kitna inaam rakhe hai… | Sholay (1975) | Hindi | A second kill within 4 s | Clean | `assets-src/memes/H14.wav` |
| H15 | Ek baar jo maine commitment kar di… | Wanted (2009) | Hindi | Kills whoever last killed them | Clean | `assets-src/memes/H15.wav` |
| H16 | Aaj khush toh bahut hoge tum | Deewar (1975) | Hindi | Wins the round | Clean | `assets-src/memes/H16.wav` |
| H17 | Tunak Tunak Tun | Daler Mehndi, song | Hindi | Wins the round | Clean | `assets-src/memes/H17.wav` |
| H18 | Main jhukega nahi, saala | Pushpa (2021) | Hindi | Hit down to 25 health or less | Spicy | `assets-src/memes/H18.wav` |
| H19 | Tumse na ho payega | Gangs of Wasseypur (2012) | Hindi | Loses the round | Clean | `assets-src/memes/H19.wav` |
| H20 | Uthaa le re baba | Hera Pheri (2000) | Hindi | Dies | Clean | `assets-src/memes/H20.wav` |
| H21 | Moye moye | Serbian song "Džanum" | Hindi | Dies | Clean | `assets-src/memes/H21.wav` |
| H22 | Saala ye dukh kaahe khatam nahi hota hai be | Masaan (2015) | Hindi | Dies a third time without a kill | Spicy | `assets-src/memes/H22.wav` |
| H23 | Apna Time Aayega | Gully Boy (2019), song | Hindi | Respawns | Clean | `assets-src/memes/H23.wav` |
| H24 | Hello friends, chai pi lo | Somvati Mahawar video | Hindi | Respawns | Clean | `assets-src/memes/H24.wav` |
| H30 | Aayein? | Viral clip, via Myinstants | Hindi | A round passes within 1.5 m | Clean | In the game |
| H31 | America kya kehta tha | Viral clip, via Myinstants | Hindi | Kills whoever last killed them | Clean | In the game |
| H32 | Are baap re, yaad aaya | Viral clip, via Myinstants | Hindi | A frag lands within 6 m | Clean | In the game |
| H33 | Chalti firti cocaine | Viral clip, via Myinstants | Hindi | Gets a kill | Spicy | In the game, 0.17 to 3.57 s of the clip |
| H34 | Meow | Viral clip, via Myinstants | Any (no words) | Jumps | Clean | In the game, 1.78 to 4.28 s of the clip |
| H35 | Iss sajjan ko kya takleef hai bhai | Viral clip, via Myinstants | Hindi | Hit | Clean | In the game |
| H36 | KGF theme | KGF (2018), fan edit, via Myinstants | Any (no words) | Wins the round | Clean | In the game, 0.1 to 6.0 s of the clip |
| H37 | Tudun tadau | Viral clip, via Myinstants | Any (no words) | A round starts | Clean | In the game, 0.4 to 5.3 s of the clip |
| E1 | Leeroy Jenkins! | 2005 gaming video | English | A round starts | Clean | `assets-src/memes/E1.wav` |
| E2 | Yeet | Vine | English | Jumps or Throws a frag | Clean | `assets-src/memes/E2.wav` |
| E3 | Deja Vu | Initial D, song | English | Sprints for 4 s | Clean | `assets-src/memes/E3.wav` |
| E4 | Yakety Sax | Benny Hill chase music | English | Sprints for 4 s | Clean | `assets-src/memes/E4.wav` |
| E5 | Why are you running? | Viral video | English | Hits someone who is sprinting | Clean | `assets-src/memes/E5.wav` |
| E6a | Omae wa mou shindeiru | Fist of the North Star | English | Throws a frag | Clean | `assets-src/memes/E6a.wav` |
| E6b | NANI?! | Fist of the North Star | English | Answers E6a, said by the player the frag lands near | Clean | `assets-src/memes/E6b.wav` |
| E7 | Oh hell nah | Viral | English | A frag lands within 6 m | Spicy | `assets-src/memes/E7.wav` |
| E8 | FBI, open up! | Viral | English | Shoots glass | Clean | `assets-src/memes/E8.wav` |
| E9 | Wow | Owen Wilson | English | Kills with a headshot | Clean | `assets-src/memes/E9.wav` |
| E10 | Noice | Brooklyn Nine-Nine | English | Gets a kill | Clean | `assets-src/memes/E10.wav` |
| E11 | Emotional damage! | Steven He | English | Gets a kill | Clean | `assets-src/memes/E11.wav` |
| E12 | Hasta la vista, baby | Terminator 2 | English | Gets a kill | Clean | `assets-src/memes/E12.wav` |
| E13 | This is Sparta! | 300 | English | Gets a kill | Clean | `assets-src/memes/E13.wav` |
| E14 | Surprise, motherf— | Dexter | English | Gets a kill | 18+ | `assets-src/memes/E14.wav` |
| E15 | Bruh | Viral | English | Out of ammunition | Clean | `assets-src/memes/E15.wav` |
| E16 | I'll be back | The Terminator | English | Dies | Clean | `assets-src/memes/E16.wav` |
| E17 | To Be Continued | "Roundabout" by Yes, song | English | Dies | Clean | `assets-src/memes/E17.wav` |
| E18 | Coffin Dance | "Astronomia", song | English | Dies | Clean | `assets-src/memes/E18.wav` |
| E19 | Oh No | TikTok song | English | Dies | Clean | `assets-src/memes/E19.wav` |
| E20 | Directed by Robert B. Weide | Curb Your Enthusiasm theme, song | English | Dies to their own frag or a fall | Clean | `assets-src/memes/E20.wav` |
| E21 | Ight, imma head out | SpongeBob | English | Leaves the room | Clean | `assets-src/memes/E21.wav` |
| E22 | Sad trombone | Classic gag | Any (no words) | Loses the round | Clean | Ships with the game |
| S1 | Vine boom | Sound effect | Any (no words) | Kills with a headshot | Clean | Ships with the game |
| S2 | Air horn | Sound effect | Any (no words) | A second kill within 4 s | Clean | Ships with the game |
| S3 | Boing | Sound effect | Any (no words) | Jumps | Clean | Ships with the game |
| S4 | Metal pipe clang | Sound effect | Any (no words) | Lands hard from a height | Clean | Ships with the game |
| S5 | Bonk | Sound effect | Any (no words) | Kills with a headshot | Clean | Ships with the game |
| S6 | Dramatic "dun dun dunnn" | Sound effect | Any (no words) | Hit down to 25 health or less | Clean | Ships with the game |
| S7 | Crickets | Sound effect | Any (no words) | A round ends with no kills | Clean | Ships with the game |
| S8 | Record scratch | Sound effect | Any (no words) | Respawns | Clean | Ships with the game |
| S9 | Fart | Sound effect | Any (no words) | Crouches three times by someone who just died | Spicy | Ships with the game |
