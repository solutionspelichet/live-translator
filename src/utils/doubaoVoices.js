// Preset voices of BytePlus Seed Speech (TTS 2.0 voice list, "uranus_bigtts"), copied from the BytePlus documentation page « Voice List ».
// Voices marked "TTS Unidirectional Streaming Only" there are left out (they do not work with bidirectional streaming).
// [speaker id, name, gender F/M]. The language is the prefix of the id (en, zh, ja, id, th, vi, ko, ms, tl, mx/es, pt, ar, de, fr, it, ru).
// WHETHER LIVE INTERPRETATION ACCEPTS THESE PRESET VOICES IS NOT CONFIRMED by the documentation: the app offers them as an experiment.

const RAW = [
  // English
  ['en_female_stokie_uranus_bigtts', 'Stokie', 'F'], ['en_female_dacey_uranus_bigtts', 'Dacey', 'F'], ['en_male_tim_uranus_bigtts', 'Tim', 'M'],
  ['en_female_nadia_uranus_bigtts', 'Blair', 'F'], ['en_male_kevin_uranus_bigtts', 'Kevin', 'M'], ['en_male_jamie_uranus_bigtts', 'Jamie', 'M'],
  ['en_female_hayley_uranus_bigtts', 'Hayley', 'F'], ['en_female_skye_uranus_bigtts', 'Skye', 'F'], ['en_male_bruce_uranus_bigtts', 'Adrian', 'M'],
  ['en_male_alex_uranus_bigtts', 'Alex', 'M'], ['en_male_yangguangjieshuonan_uranus_bigtts', 'Dylan', 'M'], ['en_male_ronald_uranus_bigtts', 'Ronald', 'M'],
  ['en_male_diyuwenrounan_uranus_bigtts', 'Julian', 'M'], ['en_male_knightley_uranus_bigtts', 'Knightley', 'M'], ['en_male_fernando-martinez_uranus_bigtts', 'Felix', 'M'],
  ['en_male_michael_uranus_bigtts', 'Hank', 'M'], ['en_male_josh_uranus_bigtts', 'Josh', 'M'], ['en_male_simba_p1_uranus_bigtts', 'Simba', 'M'],
  ['en_male_motivational-coach_uranus_bigtts', 'Rory', 'M'], ['en_male_marcus_uranus_bigtts', 'Marcus', 'M'], ['en_male_valentino_uranus_bigtts', 'Valentino', 'M'],
  ['en_male_david_uranus_bigtts', 'David', 'M'], ['en_female_allison_uranus_bigtts', 'Allison', 'F'], ['en_male_godfather_uranus_bigtts', 'Godfather', 'M'],
  ['en_male_evil-guy-oxley_uranus_bigtts', 'Harrison', 'M'], ['en_male_joker_uranus_bigtts', 'Joker', 'M'], ['en_female_wenrouzhishijieshuonv_uranus_bigtts', 'Megan', 'F'],
  ['en_female_lana_del_rey_parky_s_p1_uranus_bigtts', 'Ivy', 'F'], ['en_female_jane_uranus_bigtts', 'Jane', 'F'], ['en_female_rachel_p1_uranus_bigtts', 'Rachel', 'F'],
  ['en_male_cowboy-bob_uranus_bigtts', 'Bob', 'M'], ['en_female_female_tutor_ms-jenny_uranus_bigtts', 'Holly', 'F'], ['en_female_joanne_uranus_bigtts', 'Joanne', 'F'],
  ['en_male_adam-imitation_uranus_bigtts', 'Rowan', 'M'], ['en_male_brad_pitt_p1_uranus_bigtts', 'Brad_Pitt', 'M'], ['en_male_father-christmas_uranus_bigtts', 'Alfred', 'M'],
  ['en_male_hades_uranus_bigtts', 'Beau', 'M'], ['en_male_alberto_uranus_bigtts', 'Alberto', 'M'], ['en_female_jenny_uranus_bigtts', 'Jenny', 'F'],
  ['en_male_russell_uranus_bigtts', 'Russell', 'M'], ['en_male_tom_hiddleston_p1_uranus_bigtts', 'Tom', 'M'], ['en_female_authoritative-informative_uranus_bigtts', 'Margaret', 'F'],
  ['en_male_jidongchuanjiaoshi_uranus_bigtts', 'Blaze', 'M'], ['en_female_myra_uranus_bigtts', 'Myra', 'F'], ['en_male_bill-jones_uranus_bigtts', 'Jones', 'M'],
  ['en_female_pleasant-female_uranus_bigtts', 'Elaine', 'F'], ['en_female_scarlet_p1_uranus_bigtts', 'Scarlet', 'F'], ['en_female_brittney_uranus_bigtts', 'Brittney', 'F'],
  ['en_female_lana_del_rey_kelley_d_p1_uranus_bigtts', 'Lynn', 'F'], ['en_female_mel_uranus_bigtts', 'Mel', 'F'], ['en_male_chandler_p1_uranus_bigtts', 'Leo', 'M'],
  ['en_male_deep-voice_uranus_bigtts', 'Orion', 'M'], ['en_male_jimmy_uranus_bigtts', 'Jimmy', 'M'], ['en_male_excited-male-voice_uranus_bigtts', 'Jasper', 'M'],
  ['en_female_xinwenjieshuonv_uranus_bigtts', 'Kayla', 'F'], ['en_female_authoritative-british_uranus_bigtts', 'Charlotte', 'F'], ['en_female_zendaya_p1_uranus_bigtts', 'Zendaya', 'F'],
  ['en_male_michael-mouse_uranus_bigtts', 'Chip', 'M'], ['en_male_gollum_uranus_bigtts', 'Gollum', 'M'], ['en_female_sharron_uranus_bigtts', 'Sharron', 'F'],
  // Chinese
  ['zh_female_vv_uranus_bigtts', 'Vivi', 'F'], ['zh_male_m191_uranus_bigtts', 'Kian', 'M'], ['zh_male_taocheng_uranus_bigtts', 'Cedric', 'M'],
  ['zh_female_xiaohe_uranus_bigtts', 'Mindy', 'F'], ['zh_female_jitangnv_uranus_bigtts', 'Nadia', 'F'], ['zh_female_xiaoxue_uranus_bigtts', 'Lyla', 'F'],
  ['zh_male_shaonianzixin_uranus_bigtts', 'Jess', 'M'], ['zh_female_cancan_uranus_bigtts', 'Corinne', 'F'], ['zh_female_yingyujiaoxue_uranus_bigtts', 'Jean', 'F'],
  ['zh_female_meilinvyou_uranus_bigtts', 'Opal', 'F'], ['zh_male_ruyayichen_uranus_bigtts', 'Quentin', 'M'], ['zh_female_liuchangnv_uranus_bigtts', 'Pearl', 'F'],
  ['zh_female_linjianvhai_uranus_bigtts', 'Pinky', 'F'], ['zh_female_peiqi_uranus_bigtts', 'Holly', 'F'], ['zh_male_sophie_uranus_bigtts', 'Sophie', 'F'],
  ['zh_female_tianmeixiaoyuan_uranus_bigtts', 'Esther', 'F'], ['zh_female_sajiaoxuemei_uranus_bigtts', 'Sandy', 'F'], ['zh_male_sunwukong_uranus_bigtts', 'Monkey King', 'M'],
  ['zh_female_shuangkuaisisi_uranus_bigtts', 'Gigi', 'F'], ['zh_female_kefunvsheng_uranus_bigtts', 'Tracy', 'F'], ['zh_male_dayi_uranus_bigtts', 'Magnus', 'M'],
  ['zh_female_mizai_uranus_bigtts', 'Mabel', 'F'], ['zh_female_yuanqi_uranus_bigtts', 'Daisy', 'F'],
  // Japanese
  ['ja_female_bv024_uranus_bigtts', 'Bonnie', 'F'], ['ja_male_bv524_uranus_bigtts', 'Ken', 'M'], ['ja_female_bv522_uranus_bigtts', 'Hana', 'F'],
  ['ja_female_bv523_uranus_bigtts', 'Lily', 'F'], ['ja_female_shirou_uranus_bigtts', 'Shirou', 'F'], ['ja_female_bv520_uranus_bigtts', 'Poppy', 'F'], ['ja_female_bv521_uranus_bigtts', 'Aoi', 'F'],
  // Indonesian
  ['id_male_han_uranus_bigtts', 'Han', 'M'], ['id_female_phulia_uranus_bigtts', 'Phulia', 'F'], ['id_male_bv160_uranus_bigtts', 'Rocco', 'M'], ['id_female_bv164_uranus_bigtts', 'Crew', 'F'],
  ['id_female_bv161_uranus_bigtts', 'Clara', 'F'], ['id_male_m08_uranus_bigtts', 'Kyle', 'M'], ['id_male_bv164narration_uranus_bigtts', 'Ronan', 'M'], ['id_female_f20_uranus_bigtts', 'Chloe', 'F'],
  ['id_male_bv160dialogue_uranus_bigtts', 'Jude', 'M'], ['id_male_bv164dialogue_uranus_bigtts', 'Elian', 'M'], ['id_male_bv160narration_uranus_bigtts', 'Hugo', 'M'],
  ['id_female_bv161narration_uranus_bigtts', 'Celeste', 'F'], ['id_female_bv161dialogue_uranus_bigtts', 'Sylvia', 'F'], ['id_female_cesna_uranus_bigtts', 'Cesna', 'F'], ['id_male_ikbal_uranus_bigtts', 'Ikbal', 'M'],
  // Thai
  ['th_female_bv568_neutral_uranus_bigtts', 'Mildred', 'F'], ['th_female_bv568_angry_uranus_bigtts', 'Valeria', 'F'], ['th_female_bv568_suprise_uranus_bigtts', 'Phoebe', 'F'],
  ['th_female_bv568_hate_uranus_bigtts', 'Valentina', 'F'], ['th_female_bv568_happy_uranus_bigtts', 'Zara', 'F'], ['th_female_bv568_sad_uranus_bigtts', 'Lydia', 'F'],
  ['th_female_bv568_fear_uranus_bigtts', 'Iris', 'F'], ['th_male_angpao_uranus_bigtts', 'Angpao', 'M'], ['th_female_elle_uranus_bigtts', 'Elle', 'F'],
  // Vietnamese
  ['vi_female_partner_uranus_bigtts', 'Partner', 'F'], ['vi_female_ruan_uranus_bigtts', 'Ruan', 'F'], ['vi_female_ling_uranus_bigtts', 'Ling', 'F'], ['vi_female_linh_uranus_bigtts', 'Linh', 'F'],
  ['vi_female_wu_uranus_bigtts', 'Wu', 'F'], ['vi_female_hong_uranus_bigtts', 'Hong', 'F'], ['vi_male_wumg_uranus_bigtts', 'Wumg', 'M'], ['vi_female_f01507b_uranus_bigtts', 'Hannah', 'F'],
  // Korean
  ['ko_female_bv546_uranus_bigtts', 'Momo', 'F'], ['ko_male_bv545_uranus_bigtts', 'Jay', 'M'], ['ko_male_m03_uranus_bigtts', 'Minho', 'M'],
  // Malay
  ['ms_male_naim_uranus_bigtts', 'Naim', 'M'], ['ms_male_ham_uranus_bigtts', 'Ham', 'M'], ['ms_male_hazeem_uranus_bigtts', 'Hazeem', 'M'], ['ms_female_qis_uranus_bigtts', 'Qis', 'F'],
  // Spanish (Mexican, then European)
  ['mx_male_marcelo_uranus_bigtts', 'Marcelo', 'M'], ['mx_female_leslie_uranus_bigtts', 'Leslie', 'F'], ['mx_female_bv065_uranus_bigtts', 'Irene', 'F'], ['mx_male_bv165narrator_uranus_bigtts', 'Marcos', 'M'],
  ['mx_male_ht_mx_m012_uranus_bigtts', 'Derek', 'M'], ['mx_female_bv166dialogue_uranus_bigtts', 'Lucy', 'F'], ['mx_male_bv165dialogue_uranus_bigtts', 'Diego', 'M'],
  ['mx_female_bv166narrator_uranus_bigtts', 'Freya', 'F'], ['mx_female_bv166emotion_uranus_bigtts', 'Rosa', 'F'],
  ['es_male_guillem_uranus_bigtts', 'Guillem', 'M'], ['es_male_dani_uranus_bigtts', 'Dani', 'M'], ['es_female_bv084_uranus_bigtts', 'Gracie', 'F'], ['es_female_ht_mx_f6_uranus_bigtts', 'Marisol', 'F'],
  ['es_male_mariano_uranus_bigtts', 'Mariano', 'M'], ['es_female_romina_uranus_bigtts', 'Romina', 'F'],
  // Portuguese (Brazil)
  ['pt_female_mari_uranus_bigtts', 'Mari', 'F'], ['pt_male_rael_uranus_bigtts', 'Rael', 'M'], ['pt_female_bv530_uranus_bigtts', 'Sofia', 'F'], ['pt_male_bv531_uranus_bigtts', 'Arthur', 'M'],
  ['pt_male_bv172narrator_uranus_bigtts', 'Miles', 'M'], ['pt_female_bv173narrator_uranus_bigtts', 'Emma', 'F'], ['pt_male_bv172dialogue_uranus_bigtts', 'Walter', 'M'],
  ['pt_female_bv173_uranus_bigtts', 'Diana', 'F'], ['pt_female_bv173emotion_uranus_bigtts', 'Lola', 'F'], ['pt_male_bv172_uranus_bigtts', 'Sam', 'M'],
  ['pt_female_bv173dialogue_uranus_bigtts', 'Elena', 'F'], ['pt_male_bv172emotion_uranus_bigtts', 'Vincent', 'M'],
  // Arabic
  ['ar_female_dina_uranus_bigtts', 'Dina', 'F'], ['ar_male_youssef_uranus_bigtts', 'Youssef', 'M'], ['ar_female_fatma_uranus_bigtts', 'Fatma', 'F'],
  // German
  ['de_female_bv081_uranus_bigtts', 'Stella', 'F'],
  // French
  ['fr_female_fr_bv078_uranus_bigtts', 'Simone', 'F'], ['fr_female_fr_f47_uranus_bigtts', 'Camille', 'F'], ['fr_male_fr_m29_uranus_bigtts', 'Maurice', 'M'],
  // Russian
  ['ru_female_sophie_uranus_bigtts', 'Ksenia', 'F'], ['ru_male_pavel_uranus_bigtts', 'Pavel', 'M'], ['ru_female_irinae_uranus_bigtts', 'Irinae', 'F'], ['ru_female_af07_uranus_bigtts', 'Amelia', 'F'], ['ru_male_vlad_uranus_bigtts', 'Silas', 'M'],
];

/** Language code of the app (and of Doubao) for the prefix of a speaker id. */
const PREFIX_TO_LANG = { mx: 'es' };

export const DOUBAO_VOICES = Object.freeze(RAW.map(([id, name, gender]) => Object.freeze({ id, name, gender, lang: PREFIX_TO_LANG[id.split('_')[0]] ?? id.split('_')[0] })));

/** The preset voices of a language (Doubao code: zh, en, fr…). */
export function doubaoVoicesFor(code) {
  const base = String(code ?? '').split('-')[0];
  return DOUBAO_VOICES.filter((v) => v.lang === base);
}

/** The voice used when none was chosen: the first one of the language. */
export function defaultDoubaoVoice(code) {
  return doubaoVoicesFor(code)[0]?.id ?? null;
}

export const DOUBAO_VOICE_ID = /^[a-z]{2}_[a-z0-9_-]{1,80}$/i;
