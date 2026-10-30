"""Titles the Town feed never prints: the title half of the Reddit tab's held() in
all-day/js/reddit-lib.js. A private person's name, a username, a phone number, an
email address, a street address, anything about an arrest, a crime or an accusation,
or a flair that says the thread was misleading or removed. An address is a number,
up to three words and a street suffix; a preposition or a unit of distance or time
among those words makes it an ordinary phrase, such as a 5 mile trail. A miss costs
one tile, so this leans toward holding back."""

import re

FIRST = set('aaron abby adam adrian aiden alan albert alex alexa alexis alice alicia alison allison alyssa amanda amber amy andrea andrew andy angela anita ann anna anne annie anthony april arthur ashley audrey austin barbara becky ben benjamin beth betty blake bob bobby brad bradley brandon brenda brett brian briana bridget brittany brooke bruce bryan caleb cameron carl carla carly carol caroline carolyn carrie catherine cathy charles charlie charlotte chelsea cheryl chloe chris christina christine christopher cindy claire clara cody colin colleen connor corey courtney craig crystal cynthia dale dan dana daniel danielle danny darren dave david dawn dean deb deborah debra denise dennis derek diana diane dominic don donald donna doug douglas drew dylan ed eddie edward eileen elaine eleanor elizabeth ellen emily emma eric erica erik erin ethan eugene eva evan evelyn fiona frances francis frank fred gabriel gail gary gavin george gerald gina glenn gloria gordon greg gregory hannah harold harry heather helen henry holly howard ian irene isaac isabel jack jackie jacob jacqueline jake james jamie jan jane janet janice jared jason jay jean jeff jeffrey jen jenna jennifer jenny jeremy jerry jesse jessica jill jim jimmy joan joann joanne jody joe joel john johnny jon jonathan jordan jose joseph josh joshua joyce juan judith judy julia julie justin karen kari karl kate katherine kathleen kathryn kathy katie katrina kayla keith kelly ken kenneth kenny kevin kim kimberly kirk kristen kristin kristina kurt kyle larry laura lauren laurie lawrence leah lee leo leon leslie lila linda lindsay lindsey lisa liz logan lori louis louise lucas lucy luke lydia lynn madison maggie mandy marc marcus margaret maria marie marilyn marissa marjorie mark marshall martha martin marty mary mason matt matthew maureen max megan melanie melissa meredith mia michael michele michelle miguel mike mindy miranda misty mitch mitchell molly monica morgan nancy naomi natalie nate nathan nathaniel neil nicholas nick nicole nina noah nora norman olivia oscar owen pam pamela pat patricia patrick paul paula peggy penny pete peter phil philip phillip rachel ralph randy ray raymond rebecca regina renee rhonda richard rick ricky rita rob robert roberta robin rod rodney roger ron ronald rory ross roy ruby russell ruth ryan sally sam samantha samuel sandra sandy sara sarah scott sean seth shane shannon sharon shawn sheila shelby sherry shirley sophia sophie stacey stacy stan stanley stella stephanie stephen steve steven stuart sue susan suzanne sydney tamara tammy tanya tara taylor ted teresa terri terry theresa thomas tiffany tim timothy tina todd tom tommy toni tony tracey tracy travis trevor troy tyler valerie vanessa vera veronica vicki vicky victor victoria vincent virginia walter wanda wayne wendy wesley whitney william willie wyatt yvonne zach zachary zoe'.split())
NOT_SURNAME = set('street st ave avenue road rd drive lane park hill peak mountain lake pond river beach bay island trail bridge farm farms house hall center centre school college university hospital clinic church library market store shop shops bar cafe bakery brewery pub pizza kitchen diner deli inn hotel show band trio quartet concert festival fair night day week ave'.split())
PUBLIC = re.compile(r'\b(Phil Scott|Bernie Sanders|Becca Balint|Peter Welch|Emma Mulvaney-Stanak|Miro Weinberger|Amanda Janoo|Donald Trump|Joe Biden|Kamala Harris)\b')
NAMED = re.compile(r"\b([A-Z][A-Za-z]+)(?=\s+(?:[A-Z]\.\s+)?([A-Z][A-Za-z’'-]+))")
INITIAL = re.compile(r"(?<![\w.])[A-Z]\.\s+([A-Z][A-Za-z’'-]+)")
ROLE = re.compile(r'\b(?:officer|deputy|sgt|sergeant|detective|prosecutor|judge|mr|mrs|ms|dr|professor|principal|superintendent|councilor|coach|pastor|reverend|rev)\.?\s+([A-Za-z]+)', re.I)
CRIME = re.compile(r'\b(accus\w*|alleg\w*|arrest\w*|embezzl\w*|stole|fraud\w*|indict\w*|charged|convict\w*|assault\w*|abus\w*|molest\w*|rape\w*|rapist|pedophil\w*|predator\w*|stalk\w*|harass\w*|murder\w*|homicide|shooting|stabb\w*|sentenced|misconduct|scammer)\b', re.I)
MINOR = re.compile(r'\b1[0-7][- ]?(?:year|yr|yo)\b', re.I)
CONTACT = re.compile(r"\bu\/[A-Za-z0-9_-]+|\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b|(?<!\d)\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)|\b\d+[a-z]?\s+(?:(?!(?:at|in|on|of|the|an?|to|by|for|from|near|and|or|with|mi|miles?|km|acres?|min|minutes?|hrs?|hours?|days?|weeks?|months?|yrs?|years?)\s)[a-z.'’-]+\s+){1,3}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|pl|place|pkwy|parkway|ter|terrace|cir|circle|way|blvd|boulevard|hts|heights|xing|crossing|sq|square|aly|alley|rdg|ridge|hl|hill|bch|grn|grv|park|trl|trail)\b", re.I)
BAD_FLAIR = re.compile(r"misleading|removed", re.I)


def names_person(title):
    t = PUBLIC.sub(" ", str(title or ""))
    for m in NAMED.finditer(t):
        if m.group(1).lower() in FIRST and m.group(2).lower() not in NOT_SURNAME:
            return True
    if any(m.group(1).lower() not in NOT_SURNAME for m in INITIAL.finditer(t)):
        return True
    return any(re.match(r"[A-Z][a-z]", m.group(1)) for m in ROLE.finditer(t))


def held(title, flair=None):
    t = str(title or "")
    return names_person(t) or bool(CRIME.search(t) or MINOR.search(t) or CONTACT.search(t) or BAD_FLAIR.search(str(flair or "")))
