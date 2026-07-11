const TEST='https://test.siliconvalleyinvestclub.com';
const CK={'Cookie':'svic_token=edge-preview','User-Agent':'Mozilla/5.0'};
const arts=[
 '2026/07/08/chapter-hits-3b-valuation-with-100m-raise-interview-with-cobi-blumenfeld-gantz-ceo-co-founder',
 '2026/07/01/exploring-lightmatter-with-nicholas-harris-founder-ceo-powering-ai-with-photonic-computing',
 '2026/06/09/inside-slash-with-victor-cardenas-co-founder-ceo-the-100m-raise-at-1-4b-valuation',
 '2026/06/11/nyobolt-hits-1b-unicorn-valuation-with-60m-raise-interview-with-ramesh-narasimhan-evp-cco-cfo',
 '2026/06/17/inside-cowboy-space-with-joseph-yaffe-coo-clo-the-275m-raise-at-2b-valuation',
 '2026/07/03/interview-with-mitesh-agrawal-ceo-of-positron-ai-redefining-ai-inference-at-1b-valuation',
];
(async()=>{
  for(const a of arts){
    const s=await(await fetch(`${TEST}/${a}/?z=`+Math.random(),{headers:CK})).text();
    const mi=s.indexOf('cs-entry__media-large');
    // first cs-video-wrapper after media-large; grab data-svic-vid within its tag
    const wi=s.indexOf('cs-video-wrapper', mi);
    const tag=s.slice(wi-30, s.indexOf('>', wi)+1);
    const vid=(tag.match(/data-svic-vid="([A-Za-z0-9_-]+)"/)||[])[1]||null;
    const st=(tag.match(/data-video-start="(\d+)"/)||[])[1]||'';
    const en=(tag.match(/data-video-end="(\d+)"/)||[])[1]||'';
    console.log(a.split('/').pop().slice(0,32).padEnd(34), 'HERO vid=', vid, 'start='+st, 'end='+en);
  }
})();
