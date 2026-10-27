const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export const formatDate = (iso: string) => `${DAY.format(new Date(iso))} at ${TIME.format(new Date(iso))}`
