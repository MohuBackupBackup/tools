// @ts-check
const fs = require("fs-extra")
const { JSDOM } = require("jsdom")
const { getFewQidsAndThen } = require("../util")

const backupType = "article"
const baseFilePath = `../../archive.is/${backupType}`
const outputPath = `../../json/${backupType}`

const usersJsonFilePath = "../../backups/users.json"
/** @type {import("./typedef").UserObj[]} */
const users = fs.readJsonSync(usersJsonFilePath)

const lostUsersJsonFilePath = "../../archive.is/lost-users.json"
const lostUsers = new Set()

const tagsJsonFilePath = "../../backups/tags.json"
/** @type {{ [tagName: string]: number; }[]} */
const allTags = fs.readJsonSync(tagsJsonFilePath)

const imgUploadsJsonFilePath = "../../backups/uploads_formatted.json"
/** @type {(import("../get_user_img").imgDataItem)[]} */
const imgUploads = fs.readJsonSync(imgUploadsJsonFilePath)
const lostImgsJsonFilePath = "../../archive.is/lost-imgs.json"
const lostImgs = new Set()

/**
 * @returns {{ [qid: number]: number}}
 */
const getFormattedResData = (filePath) => {
    /** @type {{ [qid: number]: number}} */
    const formattedResData = {}

    /** @typedef {import("../util").resDataItem} resDataItem */
    /** @type {resDataItem[]} */
    const resData = fs.readJSONSync(filePath)

    resData.forEach(x => {
        formattedResData[x.id] = new Date(x.archiveTime).getTime()
    })

    return formattedResData
}
const resData = getFormattedResData(`${baseFilePath}/resData.json`)
const resDataFromArchiveOrg = getFormattedResData(`../../backups/${backupType}/resData.json`)


/** @typedef {import("./typedef").Question} Question */
/** @typedef {import("./typedef").AnswerDetail} AnswerDetail */
/** @typedef {import("./typedef").Article} Article */
/** @typedef {import("./typedef").CommentDetail} CommentDetail */
/** @typedef {import("./typedef").UserObjSimplified} UserObjSimplified */


/**
 * @param {Document} document 
 * @returns {(import("./typedef").Tag)[]}
 */
const getTagsData = (document) => {
    const tags = document.querySelectorAll("div.body > div > div > div > div > div > div > div > span > a[href]")

    return [...tags].map(x => {
        const tagName = x.textContent.trim()

        return {
            "tag-id": allTags[tagName],
            "tag-name": tagName
        }
    })
}

/**
 * 移除空白span节点
 * @param {Element} x 
 */
const removeBlankSpans = (x) => {
    const s0 = "box-sizing: border-box; -moz-box-sizing: border-box; -ms-box-sizing: border-box; "
    const s1 = s0 + "display:table;"
    const s2 = s1 + "clear:both;"

    if (x.tagName == "SPAN") {
        const style = x.getAttribute("style")

        if (style == s0 || style == s1 || style == s2) {
            x.remove()
        }
    }

    [...x.children].forEach(y => removeBlankSpans(y))
}

/**
 * @param {Element} x 
 */
const removeUselessStyle = (x) => {
    const s = "text-align:left;box-sizing: border-box; -moz-box-sizing: border-box; -ms-box-sizing: border-box;"

    const oldStyle = x.getAttribute("style")
    if (oldStyle) {
        const newStyle = oldStyle.replace(s, "").trim()
        newStyle ? x.setAttribute("style", newStyle) : x.removeAttribute("style")
    }

    return [...x.children].forEach(y => removeUselessStyle(y))
}

/**
 * @param {Element} x 
 */
const replaceDivWithP = (x, document) => {
    const base = "text-align:left;box-sizing: border-box; -moz-box-sizing: border-box; -ms-box-sizing: border-box; "
    const s0 = base + "margin: 0px 0px 10px; padding: 5px; "
    const s1 = base + "position:relative;z-index:1;line-height:1.6;word-wrap:break-word;"
    const s2 = "margin: 0px; padding: 5px;"

    const style = x.getAttribute("style")
    if (style == s0 || style == s1 || style == s2) {
        const p = document.createElement("p")
        p.innerHTML = x.innerHTML
        x.replaceWith(p)
    }

    x.querySelectorAll("div").forEach(y => replaceDivWithP(y, document))
}

/**
 * @param {HTMLAnchorElement} authorE 
 * @returns {UserObjSimplified}
 */
const getAuthor = (authorE) => {
    if (authorE && authorE.href.includes("/people/")) {
        const authorUserName = authorE.text
        const a = users.find(u => u["user-name"] == authorUserName)
        if (!a) {
            lostUsers.add(authorUserName)
        }

        return {
            "user-id": a ? a["user-id"] : -1,
            "user-name": authorUserName
        }
    } else {
        return null
    }
}

/**
 * @param {HTMLAnchorElement} userImgA 
 * @returns {UserObjSimplified}
 */
const getUserFromUserImgA = (userImgA) => {
    if (userImgA.href.includes("/people/")) {
        const userImg = userImgA.querySelector("img")
        const userName = userImg.alt

        const a = users.find(u => u["user-name"] == userName)
        if (!a) {
            lostUsers.add(userName)
        }

        return {
            "user-id": a ? a["user-id"] : -1,
            "user-name": userName
        }
    } else {
        return null
    }
}

/**
 * @param {Element} answerDiv 
 * @param {boolean} folded 
 * @returns {AnswerDetail}
 */
const getAnswerDetail = (answerDiv, folded = false) => {
    const [titleDiv, bodyDiv, metaDiv] = answerDiv.children

    const [authorInfoDiv, agreeByUsersDiv] = titleDiv.querySelectorAll("div:last-child > div")
    const authorA = authorInfoDiv.querySelector("a")
    const author = getAuthor(authorA)

    const usingMobilePhone = !!authorInfoDiv.querySelector("i:last-child")

    const agreeByUsersAs = agreeByUsersDiv.querySelectorAll("a")
    const agreeBy = [...agreeByUsersAs].filter(x => x.text != "更多 »").map(x => getAuthor(x))

    replaceDivWithP(bodyDiv, answerDiv.getRootNode())
    removeUselessStyle(bodyDiv)
    const bodyP = bodyDiv.querySelector("p")
    replaceDivWithP(bodyP, answerDiv.getRootNode())
    let body = bodyP.innerHTML.trim()

    /** @type {NodeListOf<HTMLImageElement>} */
    const bodyImgs = bodyDiv.querySelectorAll("div > a > img")
    bodyImgs.forEach(x => {
        const src = x.src
        const srcFound = imgUploads.find(u => {
            return u[0] == src
        })
        if (!srcFound) lostImgs.add(src)
        body += `\n<img src="${srcFound ? srcFound[1] : src}">`
    })

    const dateE = metaDiv.querySelector("div:only-child > span:first-child")
    const date = new Date(dateE.textContent.trim())

    /** @type {HTMLAnchorElement} */
    const commentA = metaDiv.querySelector("div:only-child > span:nth-child(3) > a")
    const comments = +commentA.text.match(/\d+/)[0]

    return {
        author,
        body,
        folded,
        "agree-by": agreeBy,
        "using-mobile-phone": usingMobilePhone,
        comments,
        publishTime: date,
        modifyTime: date,
    }
}

/**
 * @param {Element} ArticleCommentDiv 
 * @returns {CommentDetail}
 */
const getArticleCommentsDetail = (ArticleCommentDiv) => {
    const [authorDiv, bodyDiv, metadataDiv] = [...ArticleCommentDiv.children].filter(x => x.nodeName == "DIV")

    const authorImgA = authorDiv.querySelectorAll("a")[0]
    const author = getUserFromUserImgA(authorImgA)

    replaceDivWithP(bodyDiv, bodyDiv.getRootNode())
    removeUselessStyle(bodyDiv)
    const body = bodyDiv.innerHTML.trim()

    const t = metadataDiv.querySelector("div > span:not(:empty)").textContent.trim()
    const date = new Date(t)

    return {
        author,
        body,
        publishTime: date,
        modifyTime: date
    }
}

/**
 * @param {Document} document 
 * @returns {{detail: import("./typedef").QuestionDetail; answers: AnswerDetail[]; }}
 */
const getQuestionDetailAndAnswers = (document) => {
    const titleE = document.querySelector("div.body > div > div > div > div > div > div > div > h1")
    const title = titleE.textContent.trim()

    /** @type {HTMLAnchorElement} */
    const authorE = document.querySelector("div.body dd > a")
    const author = getAuthor(authorE)

    /** @type {HTMLAnchorElement} */
    const linkE = document.querySelector("div.body > div > div > div > div > div > div > div > div > div > ul a")
    const link = linkE && linkE.href

    const D = document.querySelectorAll("div.body > div > div > div > div > div > div > div > div")
    const bodyE = D[0]
    const metaDivIndex = [...D].findIndex(x => {
        const c = x.textContent
        return c.includes("分享") && !!c.match(/\d{4}(-\d{2}){2}/)
    })
    const metaDiv = D[metaDivIndex]

    replaceDivWithP(bodyE, document)
    removeUselessStyle(bodyE)
    const body = bodyE.innerHTML.trim()

    const t = metaDiv.querySelector("span").textContent.trim()
    const date = new Date(t)

    const commentA = metaDiv.querySelector("a")
    const commentT = commentA.textContent
    const comments = commentT.includes("添加评论") ? 0 : +commentT.match(/(\d+) 条评论/)[1]

    const answerDivs = [...D].slice(metaDivIndex + 2, -2)
    const answerDivsFolded = [...[...D].slice(-1)[0].children]
    const answers = [
        ...answerDivs.map(x => {
            return getAnswerDetail(x)
        }),
        ...answerDivsFolded.map(x => {
            return getAnswerDetail(x, true)
        })
    ]

    return {
        detail: {
            title,
            body,
            author,
            link,
            comments,
            publishTime: date,
            modifyTime: date
        },
        answers
    }
}

/**
 * @param {Document} document 
 * @returns {{detail: import("./typedef").ArticleDetail; comments: CommentDetail[]; }}
 */
const getArticleDetailAndComments = (document) => {

    const titleE = document.querySelector("div.body > div > div > div > div > div > div > div > h1")
    const title = titleE.textContent.trim()

    /** @type {HTMLAnchorElement} */
    const authorE = document.querySelector("div.body dd > a")
    const author = getAuthor(authorE)

    const D = document.querySelectorAll("div.body > div:nth-of-type(2) > div > div > div > div:nth-of-type(1) > div")
    const [tagsDiv, articleDiv, AllCommentsDiv] = D
    const [titleDiv, bodyDiv, votersDiv] = articleDiv.children
    const [bodyE, metaDiv] = bodyDiv.children
    const commentDivs = AllCommentsDiv.children[1].children

    replaceDivWithP(bodyE, document)
    removeUselessStyle(bodyE)
    const body = bodyE.innerHTML.trim()

    const t = metaDiv.querySelector("em").textContent.trim()
    const date = new Date(t)

    const votersAs = votersDiv.querySelectorAll("a")
    const voters = [...votersAs].map((voterA) => {
        return getUserFromUserImgA(voterA)
    })

    const comments = [...commentDivs].map(x => {
        return getArticleCommentsDetail(x)
    })


    return {
        detail: {
            title,
            body,
            author,
            voters,
            publishTime: date,
            modifyTime: date
        },
        comments
    }
}

/**
 * @param {Document} document  
 * @returns {(import("./typedef").QuestionSimplified)[]}
 */
const getRelatedQuestions = (document) => {
    /** @type {NodeListOf<HTMLAnchorElement>} */
    const qs = document.querySelectorAll("div.body > div > div > div > div > div > div > div > ul a")

    return [...qs].filter(x => {
        return x.href.match(/question\/\d+/)
    }).map(x => {
        return {
            title: x.text.trim(),
            id: +x.href.split("/").pop()
        }
    })
}

/**
 * @param {Document} document  
 * @returns {import("./typedef").QuestionStatus}
 */
const getQuestionStatus = (document) => {
    /** @type {NodeListOf<HTMLSpanElement>} */
    const statusSpans = document.querySelectorAll("div.body > div > div > div > div > div > div > div > ul > li > span")

    const [t, views, concerns] = [...statusSpans].map(x => {
        return x.textContent.trim()
    })

    return {
        "last-active-time": new Date(t),
        views: +views,
        concerns: +concerns
    }
}

/**
 * @param {number} qid 
 * @param {Document} document 
 * @returns {Question}
 */
const getQuestionData = (qid, document) => {
    const { detail, answers } = getQuestionDetailAndAnswers(document)

    return {
        type: "question",
        id: qid,
        tags: getTagsData(document),
        detail,
        answers,
        relatedQuestions: getRelatedQuestions(document),
        questionStatus: getQuestionStatus(document)
    }
}

/**
 * @param {number} qid 
 * @param {Document} document 
 * @returns {Article}
 */
const getArticleData = (qid, document) => {
    const { detail, comments } = getArticleDetailAndComments(document)

    return {
        type: "article",
        id: qid,
        tags: getTagsData(document),
        relatedQuestions: getRelatedQuestions(document),
        detail,
        comments
    }
}


/**
 * @param {number} qid 
 */
const handler = async (qid) => {
    if (resData[qid] <= resDataFromArchiveOrg[qid]) return console.log("skipped qid=" + qid)

    const html = await fs.readFile(`${baseFilePath}/${qid}.html`, "utf-8")
    const { window: { document } } = new JSDOM(html)

    try {

        removeBlankSpans(document.body)

        const data = backupType == "article" ? getArticleData(qid, document) : getQuestionData(qid, document)

        await fs.ensureDir(outputPath)
        fs.writeJSON(`${outputPath}/${qid}.json`, data, { spaces: 4 })

    } catch (e) {
        console.error(`qid=${qid} failed`)
        console.error(e)
    }

}

(async () => {
    // await handler(1883)
    // await handler(1)
    // await handler(227)

    // 一次仅处理少量文件，防止内存溢出
    await getFewQidsAndThen(handler, baseFilePath, 20)

    await fs.writeJSON(lostImgsJsonFilePath, [...lostImgs], { spaces: 4 })
    await fs.writeJSON(lostUsersJsonFilePath, [...lostUsers], { spaces: 4 })

})()
