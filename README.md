# Online English Dictionary

Look up any English word in the dictionaries you trust, hear it said, and get back to what you were reading, all without leaving your keyboard.

<!-- TODO(screenshots): add metadata/online-english-dictionary-1.png here once captured (see metadata/CAPTURE.md). -->

## What You Get

- **Five dictionaries in one window.** Cambridge, Longman, Oxford Learner's, Merriam-Webster, and Urban Dictionary, one ⌘P away from each other.
- **Pronunciation on two keys.** Press Enter for the US recording and ⌘ Enter for the UK one, on every dictionary that has them.
- **Meanings sorted by role.** Noun, verb, and every sense of a word sit in the left column; the full definition, examples, and the picture (when the dictionary has one) sit on the right.

## Commands

| Command | What it does |
|---|---|
| Search Word | Type a word, pick a dictionary, open the entry. Your recent words, with their role and dictionary, show whenever the search bar is empty. |
| Define Selected Word | Select a word in any app, run the command, and land on its entry. With nothing selected it uses the clipboard, but only when it holds a short phrase. |

Tip: add Define Selected Word to a hotkey in Raycast Settings, and the whole loop becomes one keystroke.

## Setup

Cambridge, Longman, Oxford Learner's, and Urban Dictionary work right away.

Merriam-Webster needs a free key:

1. Register at [dictionaryapi.com](https://dictionaryapi.com/register/index) and pick the dictionary you want (Learner's Dictionary has IPA transcriptions; Collegiate Dictionary has the larger word list).
2. Copy the key from "My Keys" after confirming the email.
3. Paste it into the extension preferences and choose the same dictionary in "Merriam-Webster Dictionary".

Until a key is entered, Merriam-Webster simply stays out of the list.

## Shortcuts

| Action | Shortcut |
|---|---|
| Play US pronunciation | Enter (or ⌘1) |
| Play UK pronunciation | ⌘ Enter (or ⌘2) |
| Switch dictionary | ⌘P |
| Open in the dictionary's website | ⌘O |
| Copy Definition | ⌘⇧C |
| Show Picture (when the dictionary has one) | ⌘⇧I |
| Remove a word from Recent | ⌃X |

## Fair Use

Lookups run from your own Mac, one page at a time, for your personal study. No dictionary content is stored on disk: the extension keeps only your recent words and your settings, and a pronunciation clip is written to a temporary file and deleted after it plays. Each dictionary keeps its own terms of use; please read them before using this extension for anything beyond personal, non-commercial learning. The Oxford English Dictionary itself needs a subscription, so the extension offers an "Open in OED" link instead of its content.

Thank you to the lexicographers at Cambridge University Press, Pearson Longman, Oxford University Press, Merriam-Webster, and the Urban Dictionary community. Their work is what makes a word click.

## Coming Later

- Collins Dictionary, once its API key application is approved.
- More than the first ten Urban Dictionary definitions.
- A UK recording borrowed from another dictionary when the current one has none.
- Longman example-sentence audio.
- Windows support (playback uses the macOS afplay tool today).
