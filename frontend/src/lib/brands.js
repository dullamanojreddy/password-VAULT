// ─── App logo lookup ───────────────────────────────────────────────────────
// Real brand marks (simple-icons via react-icons), matched by keyword against
// the credential's app name. Falls back to a deterministic-colour initial for
// anything unrecognised (internal tools, custom apps) rather than guessing.

import {
  SiGmail, SiGoogle, SiInstagram, SiGithub, SiNetflix, SiFacebook, SiApple,
  SiSpotify, SiPaypal, SiWhatsapp, SiZoom, SiDiscord, SiReddit, SiYoutube,
  SiTwitch, SiUber, SiAirbnb, SiNotion, SiFigma, SiTrello, SiAsana, SiJira,
  SiGitlab, SiBitbucket, SiDocker, SiTelegram, SiSnapchat, SiPinterest,
  SiEbay, SiDropbox, SiX,
} from 'react-icons/si'
import { FaLinkedin, FaAmazon, FaSlack, FaMicrosoft, FaSalesforce } from 'react-icons/fa6'
import { Landmark, Building2, KeySquare } from 'lucide-react'
import { appColor } from './config'

// Order matters — more specific patterns first.
const RULES = [
  [/gmail/, SiGmail, '#EA4335'],
  [/google/, SiGoogle, '#4285F4'],
  [/instagram/, SiInstagram, '#E4405F'],
  [/github/, SiGithub, '#e8eefc'],
  [/gitlab/, SiGitlab, '#FC6D26'],
  [/bitbucket/, SiBitbucket, '#0052CC'],
  [/jira/, SiJira, '#0052CC'],
  [/linkedin/, FaLinkedin, '#0A66C2'],
  [/amazon|\baws\b/, FaAmazon, '#FF9900'],
  [/netflix/, SiNetflix, '#E50914'],
  [/slack/, FaSlack, '#ECB22E'],
  [/facebook|\bmeta\b/, SiFacebook, '#1877F2'],
  [/microsoft|outlook|office\s*365|azure/, FaMicrosoft, '#00A4EF'],
  [/apple|icloud/, SiApple, '#e8eefc'],
  [/spotify/, SiSpotify, '#1DB954'],
  [/paypal/, SiPaypal, '#00457C'],
  [/whatsapp/, SiWhatsapp, '#25D366'],
  [/zoom/, SiZoom, '#2D8CFF'],
  [/discord/, SiDiscord, '#5865F2'],
  [/reddit/, SiReddit, '#FF4500'],
  [/youtube/, SiYoutube, '#FF0000'],
  [/twitch/, SiTwitch, '#9146FF'],
  [/uber/, SiUber, '#e8eefc'],
  [/airbnb/, SiAirbnb, '#FF5A5F'],
  [/notion/, SiNotion, '#e8eefc'],
  [/figma/, SiFigma, '#F24E1E'],
  [/trello/, SiTrello, '#0052CC'],
  [/asana/, SiAsana, '#F06A6A'],
  [/salesforce/, FaSalesforce, '#00A1E0'],
  [/docker/, SiDocker, '#2496ED'],
  [/telegram/, SiTelegram, '#26A5E4'],
  [/snapchat/, SiSnapchat, '#FFFC00'],
  [/pinterest/, SiPinterest, '#BD081C'],
  [/ebay/, SiEbay, '#E53238'],
  [/dropbox/, SiDropbox, '#0061FF'],
  [/twitter|\bx\.com\b|\bx\b/, SiX, '#e8eefc'],
  [/bank|hdfc|icici|\bsbi\b|axis|netbanking|finance/, Landmark, '#34D399'],
  [/work|corp|internal|jenkins|vpn/, Building2, '#818CF8'],
]

export function brandFor(name = '') {
  const n = name.toLowerCase()
  for (const [re, Icon, color] of RULES) {
    if (re.test(n)) return { Icon, color, isBrand: true }
  }
  return { Icon: KeySquare, color: appColor(name), isBrand: false }
}
