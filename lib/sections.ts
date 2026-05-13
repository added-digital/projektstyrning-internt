export type QuestionType = "text" | "chips";

export interface Question {
  q: string;
  type: QuestionType;
  why: string;
  placeholder: string;
}

export interface Section {
  id: number;
  title: string;
  subtitle: string;
  questions: Question[];
}

export const sections: Section[] = [
  {
    id: 1,
    title: "Affärsförståelse",
    subtitle:
      "Mål, värde och beslutsstruktur. Det här lägger grunden för varför sajten finns och vad den måste lyckas med.",
    questions: [
      {
        q: "Vad är ert viktigaste affärsmål kommande 12 månader, och hur ska sajten bidra till det?",
        type: "text",
        why: "Förankrar hela projektet i affären istället för i estetik. Utan det här svaret kan vi inte motivera ett enda designbeslut senare.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Vad är värdet på en kvalificerad lead för er – och vilken typ av lead vill ni ha mer respektive mindre av?",
        type: "text",
        why: "Få byråer frågar om leadvärde. Svaret styr hur mycket konverteringsoptimering är värt – och frågan om vilka leads de inte vill ha öppnar oftast en djupare strategidiskussion.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Hur skiljer ni er från era närmaste konkurrenter, med era egna ord?",
        type: "text",
        why: "Testar hur tydlig kundens positionering faktiskt är. Vagt svar är en signal att vi antingen behöver hjälpa dem skärpa det eller flagga det som en risk.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Vem fattar slutgiltigt beslut om designen, och vilka fler måste vara med och tycka till?",
        type: "chips",
        why: "Räddar projekt. Om en VD eller delägare dyker upp sent med starka åsikter spricker tidplanen. Få reda på beslutsstrukturen direkt.",
        placeholder: 'T.ex. "Anna Svensson — VD (beslut)"',
      },
    ],
  },
  {
    id: 2,
    title: "Målgrupp och beslutsresa",
    subtitle: "Vem klickar, vem beslutar, och vad behöver hända däremellan.",
    questions: [
      {
        q: "Vem är den typiska personen som tar första kontakten med er via sajten – roll, ansvar och vad de försöker lösa?",
        type: "chips",
        why: "Tvingar fram konkretion. Är det en marknadschef som scoutar, en VD som beslutar eller en assistent som researchar? Det styr ton, djup och informationstäthet.",
        placeholder: 'T.ex. "Marknadschef, scoutar leverantörer"',
      },
      {
        q: "Vilka andra personer är inblandade i beslutet att anlita er, och vad behöver de övertygas om?",
        type: "chips",
        why: "I B2B tas beslut sällan av en person. Den som besöker sajten behöver ofta material att övertyga internt med – sajten ska fungera för både utforskaren och det interna säljjobbet.",
        placeholder: 'T.ex. "CFO — vill se ROI-beräkning"',
      },
      {
        q: "Vad gör en besökare oftast precis innan de landar på er sajt – googlar de er, jämför de leverantörer, eller kommer de via rekommendation?",
        type: "text",
        why: "Avgör hur mycket sajten behöver sälja in jämfört med bekräfta. Rekommenderad besökare behöver trovärdighetsbevis; jämförande besökare behöver tydlig differentiering.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Vilka invändningar eller tveksamheter brukar dyka upp i säljsamtal som ni önskar att sajten kunde hantera innan mötet?",
        type: "text",
        why: "Guldgruvan. Säljarnas vanligaste invändningar är ofta de bästa rubrikerna och sektionerna på sajten – men ingen frågar säljarna.",
        placeholder: "Skriv eller klistra in svar...",
      },
    ],
  },
  {
    id: 3,
    title: "Konkurrens och inspiration",
    subtitle: "Vart vill ni positionera er, och vad ska vi medvetet undvika att likna.",
    questions: [
      {
        q: "Vilka 3–5 konkurrenter vill ni att vi benchmarkar mot, och varför just dem – är de förebilder, jämförelser eller motsatser?",
        type: "chips",
        why: "Förhindrar att vi benchmarkar mot fel konkurrenter. Genom att fråga varför får vi reda på om kunden tänker positionering eller bara stirrar uppåt.",
        placeholder: 'T.ex. "konkurrent.se — förebild för tonalitet"',
      },
      {
        q: "Vilka sajter (inom eller utanför er bransch) inspirerar er, och vad specifikt är det ni reagerar på – känsla, struktur, tonalitet eller något annat?",
        type: "chips",
        why: "Separerar det överförbara (rytm, tonalitet, whitespace) från det varumärkesbundna (specifika färger, typografi). Utan den här frågan riskerar vi en design som ser ut som en kopia.",
        placeholder: 'T.ex. "linear.app — whitespace och rytm"',
      },
      {
        q: "Finns det något ni medvetet vill undvika att likna, och vad i så fall?",
        type: "chips",
        why: "Nästan ingen ställer den här frågan. Vad kunden vill undvika är ofta tydligare och mer användbart än vad de vill efterlikna.",
        placeholder: 'T.ex. "stockfoto-stilen från konkurrent.se"',
      },
      {
        q: "Vad tror ni att era kunder jämför er med när de utvärderar – är det andra byråer/konsulter, en intern lösning, eller att inte göra något alls?",
        type: "text",
        why: "För B2B är den verkliga konkurrensen ofta inte göra något eller lösa det internt – inte en annan byrå. Det påverkar copy och argumentation mer än vilken färg konkurrenterna har på CTA-knappen.",
        placeholder: "Skriv eller klistra in svar...",
      },
    ],
  },
  {
    id: 4,
    title: "Strategiska designprinciper",
    subtitle: "Översätter affärs- och målgruppsinsikter till tydliga ledstjärnor för designen.",
    questions: [
      {
        q: "Om besökaren bara läser en sak på sajten – vad ska de då ta med sig?",
        type: "text",
        why: "Tvingar fram prioritering. B2B-sajter vill ofta säga allt till alla och slutar säga ingenting till någon. Svaret blir den röda tråden för informationsarkitekturen.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Vilken känsla ska en besökare lämna sajten med, och vilken handling ska de helst ha utfört?",
        type: "text",
        why: "Separerar känsla från handling. Sajten kan väcka rätt känsla men missa konverteringen, eller tvärtom. Båda blir ledstjärnor att designa och mäta mot.",
        placeholder: "Skriv eller klistra in svar...",
      },
      {
        q: "Vad är viktigast om vi tvingas välja: att synas tydligt i sökmotorer, att konvertera fler av de som redan hittar er, eller att höja kvaliteten på de leads som kommer in?",
        type: "text",
        why: "Alla kunder vill ha allt, men dessa mål kräver ibland motstridiga val. Att tvinga fram prioritering tidigt gör att vi kan fatta tydliga beslut senare utan att fastna.",
        placeholder: "Skriv eller klistra in svar...",
      },
    ],
  },
];

export const totalQuestions = sections.reduce(
  (acc, s) => acc + s.questions.length,
  0,
);

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export interface CustomerData {
  client: string;
  date: string;
  activeSection: number;
  answers: Answers;
  updatedAt?: string;
}

export const emptyCustomer = (client = ""): CustomerData => ({
  client,
  date: "",
  activeSection: 1,
  answers: {},
});
