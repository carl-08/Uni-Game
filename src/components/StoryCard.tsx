import type { StoryCard as StoryCardData } from '../data/storyCards';

type Props = { card: StoryCardData; selected?: boolean; disabled?: boolean; revealed?: boolean; submitted?: boolean; onClick?: () => void };

export default function StoryCard({ card, selected = false, disabled = false, revealed = false, submitted = false, onClick }: Props) {
  return <button type="button" className={`story-card${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${revealed ? ' revealed' : ''}${submitted ? ' submitted' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={selected} aria-label={`${card.title}${selected ? ', selected' : ''}`}>
    <img src={card.image} alt={card.description} loading="lazy" />
    {submitted && <span className="story-card-badge">Sent</span>}
    {revealed && <span className="story-card-caption">{card.title}</span>}
  </button>;
}
