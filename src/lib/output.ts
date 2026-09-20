export function correctedTextFromAgent(value: string): string {
  const tagged = value.match(/<corrected_text>([\s\S]*?)<\/corrected_text>/i)?.[1];
  return (tagged ?? value).trim();
}
