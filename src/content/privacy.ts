import type { Language } from '@/i18n/strings';

/** Where privacy requests go. Replace before launch; the policy prints it in the Contact section. */
export const PRIVACY_CONTACT_EMAIL = 'privacy@example.com';
/** Date shown as "Last updated". Bump whenever the policy text changes. */
export const PRIVACY_UPDATED = '2026-10-23';

export type PolicySection = { heading: string; paragraphs?: string[]; bullets?: string[]; after?: string[] };
export type PolicyText = { title: string; updated: string; intro: string[]; sections: PolicySection[] };

const en: PolicyText = {
  title: 'Privacy policy',
  updated: 'Last updated',
  intro: [
    'Vehix is a fleet management app for vehicle owners and ride-sharing fleets. This policy explains what personal data Vehix collects, why, where it is stored and what rights you have over it.',
    'Vehix is operated by the Vehix team (the "operator", "we"). For anything in this policy, write to the address in the Contact section.',
  ],
  sections: [
    {
      heading: 'What we collect',
      paragraphs: ['We only collect what the app needs to work. Everything below is stored in your account and visible only to you.'],
      bullets: [
        'Account: your email address, a display name if you set one, and a password. Passwords are stored only as a hash by our authentication provider; we never see them.',
        'Fleet data you enter: vehicles, photos, mileage, repairs, trips, running costs, service plans, compliance documents such as ITP, RCA and vignette, and their attachments.',
        'Driver data you enter: driver names, phone numbers, email addresses, driving licence numbers, licence and contract documents, vehicle assignments, weekly settlements, earnings imported from Bolt and Uber reports, and fines.',
        'Billing: your plan, subscription status and a Stripe customer reference. Card details are entered on Stripe\'s pages and never reach Vehix.',
        'Technical data: our hosting providers keep short-lived server logs with IP addresses and request details for security and error diagnosis.',
      ],
      after: ['Vehix does not use analytics, advertising or tracking services of any kind.'],
    },
    {
      heading: 'Why we process it and on what basis',
      bullets: [
        'To provide the service you signed up for: your account, your fleet records, reminders and settlements (performance of a contract).',
        'To take payment and keep invoices for paid plans (performance of a contract and legal obligation).',
        'To keep the service secure, prevent abuse and fix errors (legitimate interest).',
        'To answer when you contact us (legitimate interest).',
      ],
    },
    {
      heading: 'Your drivers\' data',
      paragraphs: [
        'When you add drivers to Vehix you are the data controller for their information, and Vehix processes it on your behalf as a processor. You are responsible for having a lawful basis to record their details, for telling them that you do, and for keeping their records accurate.',
        'We use driver data only to run your account. We never contact your drivers, share their details with other customers or use them for any other purpose.',
      ],
    },
    {
      heading: 'Who we share it with',
      paragraphs: ['We do not sell personal data and we do not share it with advertisers. The following providers process data for us under data processing agreements:'],
      bullets: [
        'Supabase: database, authentication and file storage.',
        'Vercel: web hosting and delivery.',
        'Stripe: subscription payments and invoices.',
      ],
      after: [
        'Some of these providers may process data outside the European Economic Area. Where that happens, transfers are covered by the European Commission\'s Standard Contractual Clauses or an adequacy decision such as the EU-US Data Privacy Framework.',
        'We may also disclose data when the law requires it, for example to a court or a tax authority.',
      ],
    },
    {
      heading: 'Storage on your device',
      paragraphs: [
        'Vehix does not use tracking cookies. The app stores a few items in your browser\'s local storage so it can work: your sign-in session, and the language, theme and currency you chose in Settings. If you import Bolt or Uber reports, the column mapping you confirmed is also remembered so you do not have to repeat it.',
        'These are strictly necessary for features you asked for, so no consent banner is shown. Signing out clears the session; clearing site data in your browser removes the rest.',
      ],
    },
    {
      heading: 'How long we keep it',
      bullets: [
        'Account and fleet data: for as long as your account exists. Anything you delete in the app is removed from the live database immediately and from backups within 30 days.',
        'Billing records: for as long as accounting law requires, typically 10 years in Romania, even after the account is closed.',
        'Server logs: a few weeks at most, as set by our hosting providers.',
      ],
      after: ['You can delete your account yourself at any time from Settings. This removes your account, all fleet and driver data, every uploaded file and your billing customer record straight away, and cancels any subscription. Invoices already issued are kept as described above.'],
    },
    {
      heading: 'Your rights',
      paragraphs: ['Under the GDPR you can:'],
      bullets: [
        'Access the personal data we hold about you and get a copy of it.',
        'Correct it. Most of it you can edit directly in the app.',
        'Have it deleted, subject to the retention periods above. Deleting your account from Settings does this for everything at once.',
        'Restrict or object to processing based on legitimate interest.',
        'Take your data with you in a machine-readable format.',
        'Lodge a complaint with a supervisory authority. In Romania that is the National Supervisory Authority for Personal Data Processing (ANSPDCP), dataprotection.ro.',
      ],
      after: ['To exercise any of these, email the address in the Contact section. We will reply within one month.'],
    },
    {
      heading: 'Security',
      paragraphs: [
        'All traffic to Vehix is encrypted in transit. Data is stored encrypted at rest by our providers. Every record and file in the database is protected by row-level access rules so that one account can never read another\'s data. Access to production systems is limited to the people who operate the service.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: ['Vehix is a business tool and is not intended for anyone under 18. We do not knowingly collect data from children.'],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: ['If we make a material change we will show a notice in the app before it takes effect. The date at the top tells you when the policy was last revised.'],
    },
    {
      heading: 'Contact',
      paragraphs: ['Questions, requests or complaints about personal data:'],
    },
  ],
};

const ro: PolicyText = {
  title: 'Politica de confidențialitate',
  updated: 'Ultima actualizare',
  intro: [
    'Vehix este o aplicație de administrare a flotei pentru proprietarii de vehicule și flotele de ride-sharing. Această politică explică ce date personale colectează Vehix, de ce, unde sunt stocate și ce drepturi ai asupra lor.',
    'Vehix este operat de echipa Vehix („operatorul”, „noi”). Pentru orice aspect legat de această politică, scrie-ne la adresa din secțiunea Contact.',
  ],
  sections: [
    {
      heading: 'Ce colectăm',
      paragraphs: ['Colectăm doar ce îi trebuie aplicației ca să funcționeze. Tot ce urmează este stocat în contul tău și vizibil doar ție.'],
      bullets: [
        'Cont: adresa de e-mail, un nume afișat dacă îl setezi și o parolă. Parolele sunt păstrate doar sub formă de hash de furnizorul nostru de autentificare; noi nu le vedem niciodată.',
        'Date despre flotă introduse de tine: vehicule, fotografii, kilometraj, reparații, călătorii, costuri, planuri de service, documente precum ITP, RCA și rovinietă, împreună cu atașamentele lor.',
        'Date despre șoferi introduse de tine: nume, numere de telefon, adrese de e-mail, numere de permis, documente de permis și contract, atribuiri de vehicule, decontări săptămânale, încasări importate din rapoartele Bolt și Uber și amenzi.',
        'Facturare: planul ales, starea abonamentului și o referință de client Stripe. Datele cardului sunt introduse pe paginile Stripe și nu ajung niciodată la Vehix.',
        'Date tehnice: furnizorii noștri de găzduire păstrează pentru scurt timp jurnale de server cu adrese IP și detalii despre cereri, pentru securitate și diagnosticarea erorilor.',
      ],
      after: ['Vehix nu folosește servicii de analiză, publicitate sau urmărire de niciun fel.'],
    },
    {
      heading: 'De ce le prelucrăm și pe ce temei',
      bullets: [
        'Pentru a furniza serviciul la care te-ai înscris: contul, evidența flotei, memento-urile și decontările (executarea unui contract).',
        'Pentru a încasa plata și a păstra facturile planurilor plătite (executarea unui contract și obligație legală).',
        'Pentru a menține serviciul sigur, a preveni abuzurile și a remedia erorile (interes legitim).',
        'Pentru a-ți răspunde atunci când ne contactezi (interes legitim).',
      ],
    },
    {
      heading: 'Datele șoferilor tăi',
      paragraphs: [
        'Când adaugi șoferi în Vehix, tu ești operatorul de date pentru informațiile lor, iar Vehix le prelucrează în numele tău, ca persoană împuternicită. Ești responsabil să ai un temei legal pentru a le înregistra datele, să îi informezi că o faci și să le păstrezi corecte.',
        'Folosim datele șoferilor doar pentru a-ți administra contul. Nu îi contactăm, nu le transmitem datele altor clienți și nu le folosim în alt scop.',
      ],
    },
    {
      heading: 'Cu cine le partajăm',
      paragraphs: ['Nu vindem date personale și nu le partajăm cu companii de publicitate. Următorii furnizori prelucrează date pentru noi, pe baza unor acorduri de prelucrare:'],
      bullets: [
        'Supabase: bază de date, autentificare și stocare de fișiere.',
        'Vercel: găzduire și livrare web.',
        'Stripe: plăți de abonament și facturi.',
      ],
      after: [
        'Unii dintre acești furnizori pot prelucra date în afara Spațiului Economic European. În acest caz, transferurile sunt acoperite de Clauzele Contractuale Standard ale Comisiei Europene sau de o decizie de adecvare, precum Cadrul UE-SUA privind confidențialitatea datelor.',
        'Putem divulga date și atunci când legea o cere, de exemplu unei instanțe sau unei autorități fiscale.',
      ],
    },
    {
      heading: 'Stocare pe dispozitivul tău',
      paragraphs: [
        'Vehix nu folosește cookie-uri de urmărire. Aplicația păstrează câteva elemente în stocarea locală a browserului ca să poată funcționa: sesiunea de autentificare și limba, tema și moneda alese în Setări. Dacă imporți rapoarte Bolt sau Uber, se reține și maparea coloanelor confirmată de tine, ca să nu o repeți.',
        'Acestea sunt strict necesare pentru funcțiile pe care le-ai cerut, așa că nu afișăm un banner de consimțământ. Deconectarea șterge sesiunea; ștergerea datelor site-ului din browser le elimină pe celelalte.',
      ],
    },
    {
      heading: 'Cât timp le păstrăm',
      bullets: [
        'Datele contului și ale flotei: cât timp există contul. Tot ce ștergi în aplicație dispare imediat din baza de date activă și din copiile de siguranță în cel mult 30 de zile.',
        'Documentele de facturare: cât timp cere legislația contabilă, de regulă 10 ani în România, chiar și după închiderea contului.',
        'Jurnalele de server: cel mult câteva săptămâni, conform setărilor furnizorilor de găzduire.',
      ],
      after: ['Îți poți șterge singur contul oricând din Setări. Se elimină imediat contul, toate datele despre flotă și șoferi, fiecare fișier încărcat și înregistrarea ta de client pentru facturare, iar orice abonament este anulat. Facturile deja emise se păstrează conform celor de mai sus.'],
    },
    {
      heading: 'Drepturile tale',
      paragraphs: ['Conform GDPR, poți:'],
      bullets: [
        'Să accesezi datele personale pe care le deținem despre tine și să primești o copie.',
        'Să le corectezi. Pe cele mai multe le poți edita direct în aplicație.',
        'Să ceri ștergerea lor, cu respectarea perioadelor de păstrare de mai sus. Ștergerea contului din Setări face asta pentru toate datele deodată.',
        'Să restricționezi sau să te opui prelucrării bazate pe interes legitim.',
        'Să îți iei datele într-un format care poate fi citit automat.',
        'Să depui o plângere la o autoritate de supraveghere. În România aceasta este Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), dataprotection.ro.',
      ],
      after: ['Pentru a-ți exercita oricare dintre aceste drepturi, trimite un e-mail la adresa din secțiunea Contact. Răspundem în cel mult o lună.'],
    },
    {
      heading: 'Securitate',
      paragraphs: [
        'Tot traficul către Vehix este criptat în tranzit. Datele sunt stocate criptat de furnizorii noștri. Fiecare înregistrare și fișier din baza de date este protejat prin reguli de acces la nivel de rând, astfel încât un cont nu poate citi niciodată datele altuia. Accesul la sistemele de producție este limitat la persoanele care operează serviciul.',
      ],
    },
    {
      heading: 'Minori',
      paragraphs: ['Vehix este un instrument de business și nu se adresează persoanelor sub 18 ani. Nu colectăm cu bună știință date de la minori.'],
    },
    {
      heading: 'Modificări ale acestei politici',
      paragraphs: ['Dacă facem o modificare importantă, afișăm un anunț în aplicație înainte ca aceasta să intre în vigoare. Data din partea de sus arată când a fost revizuită ultima dată politica.'],
    },
    {
      heading: 'Contact',
      paragraphs: ['Întrebări, cereri sau reclamații legate de datele personale:'],
    },
  ],
};

export const privacyPolicy: Record<Language, PolicyText> = { en, ro };
